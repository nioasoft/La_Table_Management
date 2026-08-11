import { describe, expect, it } from "vitest";
import {
  extractCoveragePeriod,
  periodsOverlap,
} from "../coverage-period";

describe("extractCoveragePeriod", () => {
  it.each([
    [
      "|_sales_report_semi_monthly_2026-07-01_2026-07-16.pdf",
      { start: "2026-07-01", end: "2026-07-16" },
      "Wolt first half — the file that stored ₪97,869",
    ],
    [
      "|_sales_report_custom_2026-07-16_2026-08-01.pdf",
      { start: "2026-07-16", end: "2026-08-01" },
      "Wolt second half — the file that was parked",
    ],
    [
      "21657_20260701_20260731.pdf",
      { start: "2026-07-01", end: "2026-07-31" },
      "10bis compact form, no dashes",
    ],
    [
      "|_sales_report_monthly_2026-07-01_2026-08-01.pdf",
      { start: "2026-07-01", end: "2026-08-01" },
      "Wolt whole month",
    ],
  ])("reads %j (%s)", (fileName, expected) => {
    expect(extractCoveragePeriod(fileName)).toEqual(expected);
  });

  it.each([
    ["ezcount-invoice.pdf", "no dates at all"],
    ["Tax_Invoice_166992.pdf", "an invoice number is not a date"],
    ["data (8).xlsx", "Tabit export"],
    ["2026-07-31_00:00:00.000_6a6d32c05e35609fc9c8a1ba.pdf", "single date, not a range"],
  ])("returns null for %j (%s)", (fileName) => {
    expect(extractCoveragePeriod(fileName)).toBeNull();
  });

  it("rejects a reversed range", () => {
    expect(
      extractCoveragePeriod("report_2026-08-01_2026-07-01.pdf"),
    ).toBeNull();
  });

  it("rejects impossible month/day values", () => {
    expect(extractCoveragePeriod("report_2026-13-01_2026-14-01.pdf")).toBeNull();
  });
});

describe("periodsOverlap", () => {
  const firstHalf = { start: "2026-07-01", end: "2026-07-16" };
  const secondHalf = { start: "2026-07-16", end: "2026-08-01" };

  it("treats the two Wolt halves as adjacent, not overlapping", () => {
    // This is THE case the merge exists for: 16/07 is the exclusive end of
    // one window and the inclusive start of the next. Reading `end` as
    // inclusive would make these overlap and the month would stay half-stored.
    expect(periodsOverlap(firstHalf, secondHalf)).toBe(false);
    expect(periodsOverlap(secondHalf, firstHalf)).toBe(false);
  });

  it("flags a genuine re-delivery of the same window", () => {
    expect(periodsOverlap(firstHalf, { ...firstHalf })).toBe(true);
  });

  it("flags a full month against one of its halves", () => {
    // A whole-month file arriving after a half-month one is the same money
    // twice — a conflict for a human, never a merge.
    const wholeMonth = { start: "2026-07-01", end: "2026-08-01" };
    expect(periodsOverlap(wholeMonth, firstHalf)).toBe(true);
    expect(periodsOverlap(wholeMonth, secondHalf)).toBe(true);
  });

  it("flags partial overlap", () => {
    expect(
      periodsOverlap(
        { start: "2026-07-01", end: "2026-07-20" },
        { start: "2026-07-16", end: "2026-08-01" },
      ),
    ).toBe(true);
  });
});
