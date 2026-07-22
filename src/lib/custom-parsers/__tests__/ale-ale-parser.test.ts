import { describe, it, expect } from "vitest";
import iconv from "iconv-lite";
import { parseAleAleFile } from "../ale-ale-parser";

/** Build a windows-1255 CSV buffer the way עלה עלה exports arrive */
function csv(rows: string[][]): Buffer {
  const text = rows.map(r => r.join(",")).join("\r\n");
  return iconv.encode(text, "windows-1255");
}

describe("parseAleAleFile — header-driven column detection", () => {
  it("parses the LEGACY layout (amount at col H, product at col D)", () => {
    const buf = csv([
      ["תקופה", "שם לקוח", "מקט", "שם פריט", "כמות", "מחיר", "מחיר תקליט", "סהכ לפריט"],
      ["אפריל 2026", "מינה יהוד", "100", "אוכמניות", "2", "10", "10", "20"],
      ["אפריל 2026", "מינה יהוד", "101", "אספרגוס", "1", "30", "30", "30"],
    ]);
    const r = parseAleAleFile(buf, 0.18);
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(r.data[0].netAmount).toBe(50);
    expect(r.summary.extractedProducts).toEqual(["אוכמניות", "אספרגוס"]);
  });

  it("parses the NEW layout (מחיר תקליט dropped, amount at col G)", () => {
    const buf = csv([
      ["תקופה", "שם לקוח", "מקט", "שם פריט", "כמות", "מחיר", "סהכ לפריט"],
      ["מאי 2026", "קינג חיפה", "100", "ארטישוק", "3", "5", "15"],
    ]);
    const r = parseAleAleFile(buf, 0.18);
    expect(r.success).toBe(true);
    expect(r.data[0].netAmount).toBe(15);
    expect(r.summary.extractedProducts).toEqual(["ארטישוק"]);
  });

  it("parses the 2026-Q2 layout (columns reshuffled, מקט moved to the end)", () => {
    const buf = csv([
      ["תקופה", "שם לקוח", "שם פריט", "כמות", "מחיר", "מחיר תקליט", "סהכ לפריט", "מקט"],
      ["אפריל 2026", "מינה יהוד", "אוכמניות", "4", "35", "לא", "140", "2092"],
    ]);
    const r = parseAleAleFile(buf, 0.18);
    expect(r.success).toBe(true);
    expect(r.data[0].netAmount).toBe(140);
    // Product NAME (not quantity/מקט) — per-item VAT matching depends on this
    expect(r.summary.extractedProducts).toEqual(["אוכמניות"]);
  });
});
