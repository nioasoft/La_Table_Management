import { describe, expect, it } from "vitest";
import * as XLSX from "xlsx";
import { parseNespressoFile } from "../nespresso-parser";

/** Build a Nespresso-shaped workbook: 6 header rows, then `rows` data rows, then the totals block. */
function buildFile(rows: [string, number, number, number][]): Buffer {
  const aoa: unknown[][] = [
    [null, null, "הפרשה לרבעון 3"],
    [],
    [],
    [],
    [null, null, "Quantity of caps", "Turnover (with VAT)", "Turnover"],
    [null, null, "מספר קפסולות", 'מחזור (כולל מע"מ)', "מחזור נטו"],
    ...rows.map(([name, caps, gross, net], i) => [name, 7000000 + i, caps, gross, net]),
    [],
    [],
    [null, null, rows.reduce((s, r) => s + r[1], 0)],
    [null, null, null, 'סה"כ', 0],
    [" "],
    [null, null, null, "מדרגת הנחה", 0.21],
  ];
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(aoa), "Sheet2");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" });
}

describe("parseNespressoFile", () => {
  it("reads rows past Excel row 28 — Q3-2026 file grew to row 30", () => {
    // Real upload f47e13d4: rows 29 (וילג' / קינג קונג עפולה) and 30 (קינג קונג מוצקין)
    // were cut off by a hardcoded last-row constant.
    const rows: [string, number, number, number][] = Array.from({ length: 22 }, (_, i) => [
      `סניף ${i + 1}`,
      1000,
      2372,
      2010,
    ]);
    rows.push(["וילג' נצרת 2021 בע\"מ קינג קונג עפולה", 3000, 7115.4, 6030]);
    rows.push(["קינג קונג מוצקין בע\"מ  ", 2500, 5929.5, 5025]);

    const r = parseNespressoFile(buildFile(rows));

    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(24);
    const afula = r.data.find((d) => d.franchisee.includes("עפולה"))!;
    expect(afula.rowNumber).toBe(29);
    expect(afula.netAmount).toBe(6030);
    expect(afula.preCalculatedCommission).toBe(630); // 3000 × 0.21
    const motzkin = r.data.find((d) => d.franchisee.startsWith("קינג קונג מוצקין"))!;
    expect(motzkin.rowNumber).toBe(30);
  });

  it("skips zero-capsule rows and the totals block", () => {
    const r = parseNespressoFile(
      buildFile([
        ["א בע\"מ", 100, 237, 201],
        ["ב בע\"מ", 0, 0, 0],
      ])
    );
    expect(r.data.map((d) => d.franchisee)).toEqual(['א בע"מ']);
  });
});
