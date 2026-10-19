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

// Q3-2026: the supplier added a "שם סוכן" column in A, shifting every column
// right by one. The section-title and totals rows still sit in column A.
const Q3_AGENT_COLUMN: unknown[][] = [
  ["קאסטרה 17% רבעון 3 2026"],
  [],
  [],
  ["שם סוכן", "מס' לקוח", "שם לקוח", "יול-26", "אוג-26", "ספט-26", "סכום כולל"],
  ["אורן זארי", "105381", 'קינג קונג ביג בע"מ', "10,415.25", "10,420.34", "13,330.50", "34,166.09"],
  ["", "106205", 'קינג קונג חורב בע"מ', "11,210.18", "15,601.70", "10,040.68", "36,852.56"],
  ["סכום כולל", "", "", "21,625.43", "26,022.04", "23,371.18", "71,018.65"],
  [],
  ["חשבונית ספק", "קוד : 600020", "הסכם 922", "", "", "17%", "12,073.17"],
  [],
  ["קאסטרה 10% רבעון 3 2026"],
  ["שם סוכן", "מס' לקוח", "שם לקוח", "יול-26", "אוג-26", "ספט-26", "סכום כולל"],
  ["יובל בן דוד", "107787", 'קינג קונג חדרה בע"מ', "", "143.80", "-128.05", "15.75"],
  ["סכום כולל", "", "", "", "143.80", "-128.05", "15.75"],
  [],
  ["חשבונית ספק", "קוד : 600020", "הסכם 922", "", "", "10%", "1.58"],
];

describe("parseMizrachUmaaravFile — Q3-2026 agent column", () => {
  it("locates name and total columns by header, not position", () => {
    const r = parseMizrachUmaaravFile(xlsx(Q3_AGENT_COLUMN));

    expect(r.success).toBe(true);
    expect(r.data.map(d => d.franchisee).sort()).toEqual(
      ['קינג קונג ביג בע"מ', 'קינג קונג חדרה בע"מ', 'קינג קונג חורב בע"מ'].sort()
    );
    // Names are names — never the agent or the customer number
    for (const row of r.data) expect(row.franchisee).not.toMatch(/^\d+$|אורן|יובל/);

    const big = r.data.find(d => d.franchisee.includes("ביג"))!;
    expect(big.netAmount).toBe(34166);
    expect(big.preCalculatedCommission).toBe(5808); // 34,166.09 * 17%

    const hadera = r.data.find(d => d.franchisee.includes("חדרה"))!;
    expect(hadera.preCalculatedCommission).toBe(2); // 15.75 * 10%
  });

  it("does not read the supplier's invoice line as a section", () => {
    const r = parseMizrachUmaaravFile(xlsx(Q3_AGENT_COLUMN));
    expect(r.data.some(d => d.franchisee.includes("הסכם"))).toBe(false);
  });

  it("fails loudly when a titled section has no recognizable header", () => {
    const broken: unknown[][] = [
      ["קאסטרה 17% רבעון 3 2026"],
      ["מס' לקוח", "שם לקוח", "יול-26", "סכום כולל"],
      ["105381", 'קינג קונג ביג בע"מ', "100", "100"],
      ["סכום כולל", "", "100", "100"],
      [],
      ["קאסטרה 10% רבעון 3 2026"],
      ["something else entirely"],
      ["105381", 'קינג קונג ביג בע"מ', "50", "50"],
    ];
    const r = parseMizrachUmaaravFile(xlsx(broken));
    expect(r.success).toBe(false);
    expect(r.errors[0].details).toContain("10%");
  });
});

// Q3-2026 as re-uploaded after a manual edit (2026-10-14): column A ("שם סוכן")
// was deleted, taking the "קאסטרה 10%" title and the "סכום כולל" labels with
// it. The 10% section is recognizable only by its header and the supplier's
// invoice line — the old title-driven parser billed it at 17%.
const Q3_EDITED_NO_10_TITLE: unknown[][] = [
  ["קאסטרה 17% רבעון 3 2026"],
  [],
  [],
  ["מס' לקוח", "שם לקוח", "יול-26", "אוג-26", "ספט-26", "סכום כולל"],
  ["101818", 'אודון ניהול ואחזקות בע"מ - מינה קיריון', "5,382.35", "4,969.44", "3,971.25", "14,323.04"],
  ["105381", 'קינג קונג ביג בע"מ', "10,415.25", "10,420.34", "13,330.50", "34,166.09"],
  ["", "", "15,797.60", "15,389.78", "17,301.75", "48,489.13"],
  [],
  ["קוד : 600020 ", "הסכם 922", "", "", "17%", "8,243.15"],
  [],
  [],
  [],
  [],
  ["מס' לקוח", "שם לקוח", "יול-26", "אוג-26", "ספט-26", "סכום כולל"],
  ["101818", 'אודון ניהול ואחזקות בע"מ - מינה קיריון', "1,623.58", "2,105.98", "677.07", "4,406.63"],
  ["", "", "1,623.58", "2,105.98", "677.07", "4,406.63"],
  [],
  ["קוד : 600020 ", "הסכם 922", "", "", "10%", "440.66"],
];

describe("parseMizrachUmaaravFile — sections without a title", () => {
  it("bills a title-less section at its invoice-line rate, not the previous section's", () => {
    const r = parseMizrachUmaaravFile(xlsx(Q3_EDITED_NO_10_TITLE));

    expect(r.success).toBe(true);
    const udon = r.data.find(d => d.franchisee.includes("אודון"))!;
    expect(udon.netAmount).toBe(18730); // 14,323.04 + 4,406.63
    expect(udon.preCalculatedCommission).toBe(2876); // 14,323.04*17% + 4,406.63*10% — prod billed 3,184
    expect(r.warnings.some(w => w.code === "GRAND_TOTAL_MISMATCH")).toBe(false);
  });

  it("never reads the supplier's invoice line as a franchisee", () => {
    const r = parseMizrachUmaaravFile(xlsx(Q3_EDITED_NO_10_TITLE));
    expect(r.data.map(d => d.franchisee)).toEqual(
      expect.not.arrayContaining([expect.stringContaining("הסכם")])
    );
    expect(r.data).toHaveLength(2);
  });

  it("finds a title that is not in column A", () => {
    const moved = Q3_AGENT_COLUMN.map((row, i) => (i === 0 ? ["", ...row] : row));
    const r = parseMizrachUmaaravFile(xlsx(moved));

    expect(r.success).toBe(true);
    expect(r.data.find(d => d.franchisee.includes("ביג"))?.preCalculatedCommission).toBe(5808);
  });

  it("fails when a section has neither a title nor an invoice-line rate", () => {
    const noRate = Q3_EDITED_NO_10_TITLE.filter(row => row[4] !== "10%");
    const r = parseMizrachUmaaravFile(xlsx(noRate));

    expect(r.success).toBe(false);
    expect(r.errors[0].details).toContain("אחוז עמלה");
  });

  it("fails when the title and the invoice line disagree on the rate", () => {
    const disagree = Q3_EDITED_NO_10_TITLE.map((row, i) => (i === 0 ? ["קאסטרה 10% רבעון 3 2026"] : row));
    const r = parseMizrachUmaaravFile(xlsx(disagree));

    expect(r.success).toBe(false);
    expect(r.errors[0].details).toContain("17%");
  });

  it("warns when the commission disagrees with the supplier's own invoice line", () => {
    const tampered = Q3_EDITED_NO_10_TITLE.map(row => (row[5] === "8,243.15" ? [...row.slice(0, 5), "9,000.00"] : row));
    const r = parseMizrachUmaaravFile(xlsx(tampered));

    expect(r.success).toBe(true);
    expect(r.warnings.find(w => w.code === "GRAND_TOTAL_MISMATCH")?.details).toContain("9,000");
  });
});
