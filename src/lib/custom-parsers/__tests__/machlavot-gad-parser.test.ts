import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseMachlavotGadFile } from "../machlavot-gad-parser";

/** Build an xlsx buffer from a rows matrix */
function xlsx(rows: unknown[][]): Buffer {
  const ws = XLSX.utils.aoa_to_sheet(rows);
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, ws, "449 - 449");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseMachlavotGadFile — header-anchored H1-2026 layout", () => {
  // Miniature replica of the real H1-2026 file: cross-ref table (cols 0-2),
  // per-brand commission table with product rows + subtotals (cols 5-8),
  // and a summary block below the cross-ref table that must be ignored.
  const rows: unknown[][] = [
    ["קטגורית לקוח", "קניות  של כל הקבוצה כולל ניגרת מ 1.1.26  עד 30.6.26", "2026", "", "", "קטגורית לקוח", "לקוח", "קניות  של פט ויני לא כולל ניגרת מ 1.1.26  עד 30.6.26", "2026"],
    ["", "", "*סכום", "", "", "", "", "", "*סכום"],
    ["פט ויני", "ויני חדרה בע\"מ", "1,000", "", "", "פט ויני", "ויני חדרה בע\"מ", "גבינות קשות", "500"],
    ["פט ויני", "ויני רגבה בע\"מ", "2,000", "", "", "פט ויני", "ויני חדרה בע\"מ", "מוצרלות", "300"],
    ["פט ויני", "פסטה דון פדרו-פרטי", "100", "", "", "פט ויני", "ויני חדרה בע\"מ", "", "800"], // subtotal row — must not double count
    ["Grand Total", "", "3,100", "", "", "פט ויני", "ויני רגבה בע\"מ", "גבינות קשות", "1,500"],
    ["", "", "", "", "", "Grand Total", "", "", "2,300"],
    ["קניות ללא ניגרת קינג קונג", "", "28,517"], // summary block — no *סכום header below, must be skipped
  ];

  it("extracts netAmount from the cross-ref table and 9% commission from base tables", () => {
    const r = parseMachlavotGadFile(xlsx(rows));
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(3);

    const hadera = r.data.find(d => d.franchisee === 'ויני חדרה בע"מ')!;
    expect(hadera.netAmount).toBe(1000); // כולל ניגרת
    expect(hadera.grossAmount).toBe(1180); // +18% VAT
    expect(hadera.preCalculatedCommission).toBe(72); // 9% × 800 (products, not subtotal)

    const regba = r.data.find(d => d.franchisee === 'ויני רגבה בע"מ')!;
    expect(regba.netAmount).toBe(2000);
    expect(regba.preCalculatedCommission).toBe(135); // 9% × 1500

    // No base entry → falls back to 9% of cross-ref amount
    const pedro = r.data.find(d => d.franchisee === "פסטה דון פדרו-פרטי")!;
    expect(pedro.preCalculatedCommission).toBe(9);

    expect(r.summary.totalNetAmount).toBe(3100);
  });

  it("fails with a clear error when the cross-ref table is missing", () => {
    const r = parseMachlavotGadFile(xlsx([["שם", "סכום"], ["א", "1"], ["ב", "2"]]));
    expect(r.success).toBe(false);
    expect(r.legacyErrors[0]).toContain("כולל ניגרת");
  });
});
