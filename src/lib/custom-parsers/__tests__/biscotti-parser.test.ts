import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import * as XLSX from "xlsx";
import { parseBiscottiFile } from "../biscotti-parser";

const fixturesDir = resolve(__dirname, "fixtures");

function xlsx(rows: unknown[][]): Buffer {
  const wb = XLSX.utils.book_new();
  XLSX.utils.book_append_sheet(wb, XLSX.utils.aoa_to_sheet(rows), "DataSheet");
  return XLSX.write(wb, { type: "buffer", bookType: "xlsx" }) as Buffer;
}

const HEADER = ["רשת", "מס' לקוח", "שם לקוח", "חודש", "סכום (ש'ח)"];

describe("parseBiscottiFile — real exports (Q3-2026)", () => {
  it("emits one row per customer per month, dated to month end (Mina, Aug+Sep)", () => {
    const buffer = readFileSync(resolve(fixturesDir, "biscotti-mina-aug-sep-2026.xlsx"));
    const r = parseBiscottiFile(buffer, 0.18);

    expect(r.success).toBe(true);
    expect(r.data).toHaveLength(2);

    const [aug, sep] = r.data;
    expect(aug.franchisee).toBe('מינה טומיי חיפה (קסטרא טומאיי בע"מ)');
    // Supplier customer number ≠ ח.פ — must not reach the business-ID matcher
    expect(aug.franchiseeId).toBeUndefined();
    expect([aug.date!.getFullYear(), aug.date!.getMonth(), aug.date!.getDate()]).toEqual([2026, 7, 31]);
    expect(aug.netAmount).toBe(992); // whole shekels (roundAmount)
    expect(aug.grossAmount).toBe(1170.0); // 991.52 × 1.18

    expect([sep.date!.getFullYear(), sep.date!.getMonth(), sep.date!.getDate()]).toEqual([2026, 8, 30]);
    expect(sep.netAmount).toBe(4032);

    expect(r.summary.totalNetAmount).toBe(5024);
  });

  it("parses the Vini September export (4 branches)", () => {
    const buffer = readFileSync(resolve(fixturesDir, "biscotti-vini-sep-2026.xlsx"));
    const r = parseBiscottiFile(buffer, 0.18);

    expect(r.success).toBe(true);
    expect(r.data.map((d) => d.franchisee)).toEqual([
      'מיאמוטו בע"מ (פט ויני קריות)',
      'פט ויני עזריאלי חיפה הע"מ',
      'ויני רגבה בע"מ',
      'ויני נתניה (סידיוס בע"מ)',
    ]);
    expect(r.data.every((d) => d.date!.getMonth() === 8)).toBe(true);
    expect(r.summary.totalNetAmount).toBe(11245); // 2506 + 4054 + 3830 + 855
  });
});

describe("parseBiscottiFile — layout variants", () => {
  it("accepts a real Excel date in the month column", () => {
    const r = parseBiscottiFile(
      xlsx([HEADER, ["פט ויני", 1, "ויני רגבה", new Date(2026, 6, 1), 100]])
    );
    expect(r.success).toBe(true);
    const d = r.data[0].date!;
    expect([d.getFullYear(), d.getMonth(), d.getDate()]).toEqual([2026, 6, 31]);
  });

  it("skips a total row and empty rows", () => {
    const r = parseBiscottiFile(
      xlsx([
        HEADER,
        ["פט ויני", 1, "ויני רגבה", "יול-26", 100],
        [],
        ["", "", 'סה"כ', "", 100],
      ])
    );
    expect(r.data).toHaveLength(1);
    expect(r.summary.totalNetAmount).toBe(100);
  });

  it("keeps the row with a null date and warns when the month is unreadable", () => {
    const r = parseBiscottiFile(xlsx([HEADER, ["פט ויני", 1, "ויני רגבה", "רבעון 3", 100]]));
    expect(r.success).toBe(true);
    expect(r.data[0].date).toBeNull();
    expect(r.warnings.length).toBeGreaterThan(0);
  });
});

describe("parseBiscottiFile — guards", () => {
  it("fails cleanly when the header row is missing", () => {
    const r = parseBiscottiFile(xlsx([["לקוח", "סכום"], ["ויני רגבה", 100]]));
    expect(r.success).toBe(false);
    expect(r.errors[0].details).toContain("שם לקוח");
  });
});
