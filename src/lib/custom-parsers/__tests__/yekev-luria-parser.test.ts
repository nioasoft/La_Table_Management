import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { parseYekevLuriaFile } from "../yekev-luria-parser";

const fixturesDir = resolve(__dirname, "fixtures");

describe("parseYekevLuriaFile — customer-summary layout (2026-07 export)", () => {
  // Real production export from upload 4e4d3798 (2026-07-08): sheet
  // "d_customers_sale_report", one cumulative row per customer for
  // 01/01/26–30/06/26, sheet range anchored at B3 (columns are offset).
  const buffer = readFileSync(
    resolve(fixturesDir, "yekev-luria-customer-summary.xlsx")
  );

  it("extracts one row per customer with the supplier customer code", () => {
    const r = parseYekevLuriaFile(buffer);

    expect(r.success).toBe(true);
    // File's own total row: "סה"כ 18 לקוחות" / 210,800
    expect(r.data).toHaveLength(18);
    expect(Math.abs(r.summary.totalNetAmount - 210800)).toBeLessThanOrEqual(2);

    // Supplier customer codes (8 digits) come from the מס' לקוח column and
    // feed the same code-based matching the block layout produced
    for (const row of r.data) {
      expect(row.franchiseeId).toMatch(/^\d{8}$/);
    }

    const village = r.data.find((d) => d.franchiseeId === "50684870")!;
    expect(village.netAmount).toBe(9698);
    expect(village.grossAmount).toBe(11444); // 9698 * 1.18 rounded
    expect(village.franchisee).toContain("נצרת");
  });

  it("skips the grand-total row", () => {
    const r = parseYekevLuriaFile(buffer);
    expect(r.data.some((d) => d.franchisee.includes('סה"כ'))).toBe(false);
  });

  it("emits a cumulative-period anomaly with the report's date range", () => {
    const r = parseYekevLuriaFile(buffer);

    expect(r.anomalies).toBeDefined();
    const anomaly = r.anomalies!.find((a) => a.code === "MIXED_PERIODS")!;
    expect(anomaly).toBeDefined();
    expect(anomaly.severity).toBe("warning");
    expect(anomaly.messageHe).toContain("01/01/26");
    expect(anomaly.messageHe).toContain("30/06/26");
  });
});

describe("parseYekevLuriaFile — block layout document types", () => {
  // Q3-2026 export (upload c06fc4fc) listed every sale twice: as "הזמנה"
  // (order, doc 7/…) and as "חשבונית מס" (doc 1/…). Summing both billed
  // 189,330 instead of 94,301. Only invoices and credit notes are sales.
  const header = [null, 'סך הכל ש"ח לאחר הנחה', null, 'סך הכל ש"ח', "מחיר ליחידה", "כמות", "תאריך", "מספר מסמך", null, "סוג מסמך", null, null, "שם לקוח"];
  const line = (amount: number, docType: string, customer: string) =>
    [null, amount, null, amount, null, null, 46208, "1/1", null, docType, null, null, customer];
  const sub = [null, null, null, null, null, null, null, null, null, null, null, "סה''כ מכירות יין"];

  function workbook(rows: unknown[][]): Buffer {
    const wb = XLSX.utils.book_new();
    XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "דוח מכירות לפי פריטים");
    return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
  }

  const buffer = workbook([
    [null, null, null, null, null, null, null, null, null, null, null, null, "מכירות יין אדום פריט מספר 7"],
    [],
    header,
    line(100, "חשבונית מס", "קינג קונג חדרה נוי אדרי 50685501"),
    line(100, "הזמנה", "קינג קונג חדרה נוי אדרי 50685501"),
    line(-10, "חשבונית מס זיכוי", "קינג קונג חדרה נוי אדרי 50685501"),
    line(50, "חשבונית מס", "פט ויני כרמיאל מרים 50685580"),
    line(999, "הזמנה", "מינה טומאיי שרונה בע\"מ שגיא 50685600"),
    sub,
  ]);

  it("counts invoices and credit notes, never orders", () => {
    const r = parseYekevLuriaFile(buffer);

    expect(r.success).toBe(true);
    expect(r.summary.totalNetAmount).toBe(140);
    expect(r.data.map((d) => [d.franchisee, d.netAmount])).toEqual([
      ["קינג קונג חדרה נוי אדרי", 90],
      ["פט ויני כרמיאל מרים", 50],
    ]);
  });

  it("warns about the skipped order rows instead of dropping them silently", () => {
    const r = parseYekevLuriaFile(buffer);
    const w = r.warnings.find((x) => x.code === "LURIA_NON_INVOICE_ROWS_SKIPPED");
    expect(w?.message).toContain("הזמנה");
  });
});
