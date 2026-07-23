import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseSoberLernerFile } from "../sober-lerner-parser";

function xlsx(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "גיליון1");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// Condensed from the real Q2-2026 file: month in col A, franchisee in col B
// (forward-filled), amount in G, pre-calculated commission in I. The final
// totals row uses an ASCII quote (סה"כ), not gershayim (סה״כ).
const REAL_FILE: unknown[][] = [
  [null, "סניף", "פריט מקט", "תאור", "כמות", "מחיר לזכיין", "סהכ לזכיין", "עמלת רשת לפריט ", "סהכ עמלת רשת"],
  [],
  ["אפריל", "קינג עפולה", "king10", "סושי", 100, 33, 3300, 5, 500],
  [null, "מינה עין שמר", "mina06", "ווק", 30, 68, 2040, 4, 120],
  [null, null, "mina05", "קרפציו", 10, 48, 480, 5, 50],
  [null, null, null, null, null, null, 0, null, 0],
  ["יוני", "קינג נהריה", "king10", "סושי", 60, 35, 2100, 3, 180],
  ['סה"כ', null, null, null, null, null, null, null, 850],
];

describe("parseSoberLernerFile", () => {
  it("skips the totals row regardless of quote style", () => {
    const r = parseSoberLernerFile(xlsx(REAL_FILE));

    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(3);

    // Before the fix, the סה"כ (ASCII quote) row slipped past SKIP_KEYWORDS
    // and forward-fill credited its total to the last franchisee.
    const nahariya = r.data.find(d => d.franchisee.includes("נהריה"))!;
    expect(nahariya.preCalculatedCommission).toBe(180);
    expect(nahariya.netAmount).toBe(2100);
  });

  it("aggregates multi-row franchisee blocks via forward-fill", () => {
    const r = parseSoberLernerFile(xlsx(REAL_FILE));
    const einShemer = r.data.find(d => d.franchisee.includes("עין שמר"))!;
    expect(einShemer.netAmount).toBe(2520); // 2040 + 480
    expect(einShemer.preCalculatedCommission).toBe(170); // 120 + 50
  });

  it("still skips gershayim and plain summary keywords", () => {
    const withVariants: unknown[][] = [
      [null, "סניף", null, null, null, null, "סהכ לזכיין", null, "סהכ עמלת רשת"],
      [null, "קינג עפולה", null, null, null, null, 1000, null, 100],
      ["סה״כ", null, null, null, null, null, null, null, 100],
      ["סיכום", null, null, null, null, null, null, null, 100],
    ];
    const r = parseSoberLernerFile(xlsx(withVariants));
    expect(r.data).toHaveLength(1);
    expect(r.data[0].preCalculatedCommission).toBe(100);
  });
});
