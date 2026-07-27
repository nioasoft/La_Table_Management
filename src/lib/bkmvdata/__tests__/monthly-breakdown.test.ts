import { describe, it, expect } from "vitest";
import { changedMonths, groupIntoConsecutiveRuns } from "../monthly-breakdown";
import type { MonthlyBreakdown } from "../types";

const entry = (
  supplierName: string,
  amount: number,
  supplierId: string | null = null
) => ({ supplierId, supplierName, amount, transactionCount: 1 });

const q1: MonthlyBreakdown = {
  "2026-01": [entry("מקאטי", 1000, "sup-1"), entry("גרינטי", 500, "sup-2")],
  "2026-02": [entry("מקאטי", 2000, "sup-1")],
  "2026-03": [entry("מקאטי", 3000, "sup-1")],
};

describe("changedMonths", () => {
  it("returns nothing when a cumulative file repeats stored data", () => {
    // Entry order flips between files (buildMonthlyBreakdown sorts by amount) —
    // must not count as a change.
    const reordered: MonthlyBreakdown = {
      ...q1,
      "2026-01": [entry("גרינטי", 500, "sup-2"), entry("מקאטי", 1000, "sup-1")],
    };
    expect(changedMonths(q1, reordered)).toEqual([]);
  });

  it("returns only the new months of a Q2 upload", () => {
    const withQ2: MonthlyBreakdown = {
      ...q1,
      "2026-04": [entry("מקאטי", 4000, "sup-1")],
      "2026-05": [entry("מקאטי", 5000, "sup-1")],
    };
    expect(changedMonths(q1, withQ2)).toEqual(["2026-04", "2026-05"]);
  });

  it("catches an amount that changed in an already-stored month", () => {
    const corrected: MonthlyBreakdown = {
      ...q1,
      "2026-02": [entry("מקאטי", 2222, "sup-1")],
    };
    expect(changedMonths(q1, corrected)).toEqual(["2026-02"]);
  });

  it("counts a supplierId resolving from null as a change", () => {
    const unresolved: MonthlyBreakdown = {
      "2026-01": [entry("מקאטי", 1000, null)],
    };
    const resolved: MonthlyBreakdown = {
      "2026-01": [entry("מקאטי", 1000, "sup-1")],
    };
    expect(changedMonths(unresolved, resolved)).toEqual(["2026-01"]);
  });

  it("treats a first-ever upload as all-changed", () => {
    expect(changedMonths(undefined, q1)).toEqual([
      "2026-01",
      "2026-02",
      "2026-03",
    ]);
  });
});

describe("groupIntoConsecutiveRuns", () => {
  it("keeps a gap apart so Jan+Jul don't drag Feb–Jun along", () => {
    expect(groupIntoConsecutiveRuns(["2026-01", "2026-07"])).toEqual([
      ["2026-01", "2026-01"],
      ["2026-07", "2026-07"],
    ]);
  });

  it("merges consecutive months, across a year boundary", () => {
    expect(
      groupIntoConsecutiveRuns(["2025-11", "2025-12", "2026-01", "2026-04"])
    ).toEqual([
      ["2025-11", "2026-01"],
      ["2026-04", "2026-04"],
    ]);
  });

  it("returns nothing for no months", () => {
    expect(groupIntoConsecutiveRuns([])).toEqual([]);
  });
});
