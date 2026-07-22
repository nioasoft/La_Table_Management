import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
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
