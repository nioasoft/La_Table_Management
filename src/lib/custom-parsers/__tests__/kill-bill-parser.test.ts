import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { parseKillBillFile } from "../kill-bill-parser";

const fixturesDir = resolve(__dirname, "fixtures");

/** Build an xlsx buffer from rows */
function xlsx(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "DataSheet");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

describe("parseKillBillFile — Q2-2026 layout (header at row 0, name at col B)", () => {
  // Real production export from upload d86fd03b (2026-07-02). Before the
  // header-driven fix, the parser fell into the legacy path and read the
  // customer NUMBER as the amount and the net amount as the franchisee name.
  const buffer = readFileSync(resolve(fixturesDir, "kill-bill-q2-2026.xlsx"));

  it("maps columns by header text and aggregates per franchisee", () => {
    const r = parseKillBillFile(buffer);

    expect(r.success).toBe(true);
    // 38 monthly rows collapse into 20 franchisees
    expect(r.data).toHaveLength(20);

    // Regression: franchisee names are names, not amounts
    for (const row of r.data) {
      expect(row.franchisee).not.toMatch(/^\d+([.,]\d+)?$/);
    }

    const carmiel = r.data.find((d) => d.franchisee === 'קינג כרמיאל בע"מ')!;
    expect(carmiel).toBeDefined();
    // 1067.80 + 2000.00 net, 1260 + 2360 gross
    expect(carmiel.netAmount).toBe(3068);
    expect(carmiel.grossAmount).toBe(3620);

    // File totals (±2 for per-franchisee rounding)
    expect(Math.abs(r.summary.totalNetAmount - 115299)).toBeLessThanOrEqual(2);
    expect(Math.abs(r.summary.totalGrossAmount - 136053)).toBeLessThanOrEqual(2);
  });
});

describe("parseKillBillFile — previous aggregated layout (header at row 1, name at col F)", () => {
  const rows: unknown[][] = [
    ["נכון לתקופה: 01/01/2026-31/03/2026"],
    ["מטבע", "הכנסה משוערכת", "מטבע", "הכנסה", 'הכנסה כולל מע"מ', "שם לקוח", "מס. לקוח", "חודש"],
    ['ש"ח', "1000", 'ש"ח', "1000", "1180", 'ויני רגבה בע"מ', "101311", "1"],
    ['ש"ח', "500", 'ש"ח', "500", "590", 'ויני רגבה בע"מ', "101311", "2"],
    ['ש"ח', "2000", 'ש"ח', "2000", "2360", 'מינה שרונה בע"מ', "101333", "1"],
  ];

  it("still parses via the same header-driven path", () => {
    const r = parseKillBillFile(xlsx(rows));

    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(2);

    const regba = r.data.find((d) => d.franchisee === 'ויני רגבה בע"מ')!;
    expect(regba.netAmount).toBe(1500);
    expect(regba.grossAmount).toBe(1770);
  });
});

describe("parseKillBillFile — legacy grouped layout", () => {
  const rows: unknown[][] = [
    ["תקופה 01/2026"],
    ["סכום במטבע החשבונית", null, null, null, null, null, "שם לקוח"],
    ["1000", null, null, null, null, null, 'ויני רגבה בע"מ'],
    ["500", null, null, null, null, null, null], // continuation row, same group
    ['סה"כ', null, null, null, null, null, null],
    ["2000", null, null, null, null, null, 'מינה שרונה בע"מ'],
  ];

  it("groups detail rows under the running franchisee", () => {
    const r = parseKillBillFile(xlsx(rows));

    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(2);

    const regba = r.data.find((d) => d.franchisee === 'ויני רגבה בע"מ')!;
    expect(regba.netAmount).toBe(1500);
  });
});
