import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseMizrachUmaaravFile } from "../mizrach-umaarav-parser";

function xlsx(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "גיליון1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// Condensed from the real Q2-2026 file. Customer 105977 is the OLD legal
// entity of קאסטרה רעננה with a negative credit line; 108540 is the new one.
// The supplier's own totals row and invoice net the credit.
const REAL_FILE: unknown[][] = [
  ["קאסטרה 17% רבעון 2 2026"],
  [],
  ["מס' לקוח", "שם לקוח", "אפר", "מאי", "יונ", "סכום כולל"],
  ["101444", "קסטרא טומאי בע'מ", " 9,952.7 ", " 12,831.4 ", " 13,329.7 ", " 36,113.8 "],
  ["105977", 'אטפה בע"מ - קינג קונג קאסטרה רעננה(יש חדש108540)', " -13,383.9 ", null, null, " -13,383.9 "],
  ["108540", 'ק.ק מסעדה אסייתית רעננה בע"מ', " 19,882.2 ", " 9,051.7 ", " 10,461.0 ", " 39,394.9 "],
  ["סכום כולל", null, " 16,451.0 ", " 21,883.1 ", " 23,790.7 ", " 62,124.8 "],
  [],
  ["קאסטרה 10% רבעון 2 2026"],
  [],
  ["מס' לקוח", "שם לקוח", "אפר", "מאי", "יונ", "סכום כולל"],
  ["101444", "קסטרא טומאי בע'מ", " 1,289.65 ", " 1,588.92 ", " 2,831.37 ", " 5,709.94 "],
  ["סכום כולל", null, " 1,289.65 ", " 1,588.92 ", " 2,831.37 ", " 5,709.94 "],
];

describe("parseMizrachUmaaravFile", () => {
  it("keeps negative credit rows so they can net against the new entity", () => {
    const r = parseMizrachUmaaravFile(xlsx(REAL_FILE));

    expect(r.success).toBe(true);
    const atfa = r.data.find(d => d.franchisee.includes("אטפה"))!;
    expect(atfa).toBeDefined();
    expect(atfa.netAmount).toBe(-13384);
    expect(atfa.preCalculatedCommission).toBe(-2275); // -13,383.9 * 17%

    // Net of old + new entity must equal the supplier's own math
    const newEntity = r.data.find(d => d.franchisee.includes("ק.ק מסעדה"))!;
    expect((atfa.preCalculatedCommission ?? 0) + (newEntity.preCalculatedCommission ?? 0)).toBe(4422); // 26,011 * 17%
  });

  it("aggregates a franchisee across the 17% and 10% sections", () => {
    const r = parseMizrachUmaaravFile(xlsx(REAL_FILE));
    const tomai = r.data.find(d => d.franchisee.includes("טומאי"))!;
    expect(tomai.netAmount).toBe(41824); // 36,113.8 + 5,709.94
    expect(tomai.preCalculatedCommission).toBe(6710); // 36,113.8*17% + 5,709.94*10%
  });

  it("still skips zero/empty rows", () => {
    const withZero: unknown[][] = [
      ["קאסטרה 17% רבעון 2 2026"],
      [],
      ["מס' לקוח", "שם לקוח", "אפר", "מאי", "יונ", "סכום כולל"],
      ["101444", "קסטרא טומאי בע'מ", null, null, null, " - "],
      ["105381", 'קינג קונג ביג בע"מ', " 6,057.6 ", null, null, " 6,057.6 "],
      ["סכום כולל", null, null, null, null, " 6,057.6 "],
    ];
    const r = parseMizrachUmaaravFile(xlsx(withZero));
    expect(r.data).toHaveLength(1);
    expect(r.data[0].franchisee).toContain("קינג קונג ביג");
  });
});
