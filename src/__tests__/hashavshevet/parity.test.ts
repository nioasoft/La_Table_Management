import { describe, expect, it } from "vitest";

import { compareSheetToRows } from "@/lib/hashavshevet/parity";
import type { BuiltRow } from "@/lib/hashavshevet/types";

const HEADER = ["מפתח חשבון", "כמות", "מחיר", "פרטים"];

function built(display: Record<string, string | number>): BuiltRow {
  return { rowKey: "k", companyId: null, documentKey: "k", amount: 0, display, apiRow: {}, periodEnd: "2026-06-30" };
}

const ROW = built({ "מפתח חשבון": "אושיבה", כמות: 1, מחיר: 48228.82838983051, פרטים: "" });

describe("compareSheetToRows", () => {
  it("finds no difference when the sheet matches, comparing numbers to two decimals", () => {
    expect(compareSheetToRows([HEADER, ["אושיבה", 1, 48228.83, ""]], [ROW])).toEqual([]);
  });

  it("treats an empty cell and an empty string as equal", () => {
    expect(compareSheetToRows([HEADER, ["אושיבה", 1, 48228.83]], [ROW])).toEqual([]);
  });

  it("reports a header mismatch", () => {
    const diffs = compareSheetToRows([["מפתח", "כמות", "מחיר", "פרטים"], ["אושיבה", 1, 48228.83, ""]], [ROW]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain("header");
  });

  it("reports a number that differs by a cent, naming the row and column", () => {
    const diffs = compareSheetToRows([HEADER, ["אושיבה", 1, 48228.84, ""]], [ROW]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain("row 2");
    expect(diffs[0]).toContain("מחיר");
  });

  it("reports a text difference", () => {
    const diffs = compareSheetToRows([HEADER, ["מינה", 1, 48228.83, ""]], [ROW]);
    expect(diffs).toHaveLength(1);
    expect(diffs[0]).toContain("מפתח חשבון");
  });

  it("reports rows missing on either side", () => {
    expect(compareSheetToRows([HEADER], [ROW])).toHaveLength(1);
    expect(compareSheetToRows([HEADER, ["אושיבה", 1, 48228.83, ""], ["x", 1, 1, ""]], [ROW])).toHaveLength(1);
  });

  it("compares a dd/mm/yyyy display date with the sheet's date serial, whatever its time-zone fraction", () => {
    const dated = built({ תאריך: "30/09/2026", סכום: 1 });
    expect(compareSheetToRows([["תאריך", "סכום"], [46295, 1]], [dated])).toEqual([]);
    expect(compareSheetToRows([["תאריך", "סכום"], [46295.00046296296, 1]], [dated])).toEqual([]);
    expect(compareSheetToRows([["תאריך", "סכום"], [46294, 1]], [dated])).toHaveLength(1);
    expect(compareSheetToRows([["תאריך", "סכום"], ["30/09/2026", 1]], [dated])).toEqual([]);
  });

  it("accepts a header-only or empty sheet for zero rows", () => {
    expect(compareSheetToRows([], [])).toEqual([]);
    expect(compareSheetToRows([HEADER], [])).toEqual([]);
  });
});
