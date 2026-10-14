import { describe, it, expect } from "vitest";
import * as XLSX from "xlsx";
import { parseMaadaneiHatevaFile } from "../maadanei-hateva-parser";

function xlsx(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "DataSheet");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

// Q2-2026: per-product report, amount "הכנסה" in G
const PER_PRODUCT: unknown[][] = [
  ["מס. לקוח", "שם לקוח", "מק'ט", "תאור מוצר", "כמות", "יח'", "הכנסה", "מטבע"],
  ["100070", 'קינג געתון בע"מ (מסעדת קינג קונג)', "211", "טופז", "24", "יח'", "2016.00", 'ש"ח'],
  ["100070", 'קינג געתון בע"מ (מסעדת קינג קונג)', "467", "קשיו", "3", "יח'", "332.64", 'ש"ח'],
];

// Q3-2026: per-month report, amount "סכום בשקלים" in F, column G empty
const PER_MONTH: unknown[][] = [
  ["מס. לקוח", "שם לקוח", "שנה", "חודש", "כמות מפעל", "סכום בשקלים", ""],
  ["100070", 'קינג געתון בע"מ (מסעדת קינג קונג)', "2026", "יול", "12", "1142.40", ""],
  ["100070", 'קינג געתון בע"מ (מסעדת קינג קונג)', "2026", "אוג", "33", "2852.64", ""],
  ["100129", 'קינג קונג חדרה בע"מ', "2026", "יול", "13", "1145.76", ""],
];

describe("parseMaadaneiHatevaFile", () => {
  it("still parses the per-product layout", () => {
    const r = parseMaadaneiHatevaFile(xlsx(PER_PRODUCT));
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(1);
    expect(r.data[0].netAmount).toBe(2349); // 2016 + 332.64
  });

  it("aggregates the per-month layout by franchisee", () => {
    const r = parseMaadaneiHatevaFile(xlsx(PER_MONTH));
    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(2);
    const gaaton = r.data.find(d => d.franchisee.includes("געתון"))!;
    expect(gaaton.netAmount).toBe(3995); // 1142.40 + 2852.64
    // Never the quantity column
    expect(r.summary.totalNetAmount).toBe(3995 + 1146);
  });

  it("fails with the missing header named when no amount column exists", () => {
    const r = parseMaadaneiHatevaFile(xlsx([["מס. לקוח", "שם לקוח", "כמות"], ["1", "x", "5"]]));
    expect(r.success).toBe(false);
    expect(r.errors[0].details).toContain("הכנסה");
  });
});
