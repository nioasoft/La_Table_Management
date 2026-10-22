import { describe, it, expect } from "vitest";
import iconv from "iconv-lite";
import { parseAleAleFile } from "../ale-ale-parser";

/** Build a windows-1255 CSV buffer the way עלה עלה exports arrive */
function csv(rows: string[][]): Buffer {
  // Item names carry a unit after a comma ("שום קלוף מובחר,קג") — quoted, as exported
  const text = rows.map(r => r.map(c => (c.includes(",") ? `"${c}"` : c)).join(",")).join("\r\n");
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

describe("parseAleAleFile — per-item VAT", () => {
  // Vini Azrieli Q3-2026: one unflagged ₪260 line left a ₪47 gap against מבנה אחיד
  const buf = csv([
    ["חברה", "תקופה", "קבוצת לקוח", "שם לקוח", "שם פריט", "כמות", "מחיר", "מחיר תקליט", "סהכ לפריט", "מקט"],
    ["עלה עלה", "אוג-26", "מינה טומיי", "פאט ויני עזריאלי חיפה", "שום קלוף מובחר,קג", "10", "27", "לא", "270", "1"],
    ["עלה עלה", "אוג-26", "מינה טומיי", "פאט ויני עזריאלי חיפה", "עגבניות סופריי 2 קג מארז,חבילה", "1", "260", "לא", "260", "2080"],
    ["עלה עלה", "אוג-26", "מינה טומיי", "פאט ויני עזריאלי חיפה", "חסה לאליק,נספאק", "10", "10", "לא", "100", "3"],
  ]);

  it("adds VAT only on flagged items; net stays the item total", () => {
    const r = parseAleAleFile(buf, 0.18, new Set(["שום קלוף מובחר,קג"]));
    expect(r.data[0].netAmount).toBe(630);
    expect(r.data[0].grossAmount).toBe(679); // 630 + 18% × 270 = 678.60 → whole shekels
  });

  it("flagging one more item raises gross by 18% of that item and leaves net alone", () => {
    const r = parseAleAleFile(
      buf,
      0.18,
      new Set(["שום קלוף מובחר,קג", "עגבניות סופריי 2 קג מארז,חבילה"])
    );
    expect(r.data[0].netAmount).toBe(630);
    expect(r.data[0].grossAmount).toBe(725); // + 18% × 260 = 46.80 → 725.40 → whole shekels
  });
});
