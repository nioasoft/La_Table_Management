import { describe, it, expect } from "vitest";
import { bkmvCoverageEnd, bkmvPeriodDueThrough } from "@/lib/bkmv-coverage";

describe("bkmvCoverageEnd", () => {
  it("caps a future period_end_date at the upload date", () => {
    // טמפר הסעדה in production: uploaded 07/05, period_end_date 29/12.
    expect(bkmvCoverageEnd("2026-12-29", new Date(2026, 4, 7))).toBe("2026-04-30");
  });

  it("drops the incomplete month of a mid-month export", () => {
    expect(bkmvCoverageEnd("2026-06-02", new Date(2026, 5, 2))).toBe("2026-05-31");
  });

  it("keeps a month that ended exactly on the last transaction", () => {
    expect(bkmvCoverageEnd("2026-04-30", new Date(2026, 4, 20))).toBe("2026-04-30");
  });

  it("covers the closed quarter for a file exported after it ended", () => {
    expect(bkmvCoverageEnd("2026-07-22", new Date(2026, 6, 27))).toBe("2026-06-30");
  });

  it("rolls back across the year boundary", () => {
    expect(bkmvCoverageEnd("2026-01-12", new Date(2026, 0, 12))).toBe("2025-12-31");
  });

  it("handles February in a leap year", () => {
    expect(bkmvCoverageEnd("2028-02-29", new Date(2028, 1, 29))).toBe("2028-02-29");
    expect(bkmvCoverageEnd("2028-03-05", new Date(2028, 2, 5))).toBe("2028-02-29");
  });

  it("uses period_end_date when it precedes the upload", () => {
    expect(bkmvCoverageEnd("2026-03-31", new Date(2026, 4, 7))).toBe("2026-03-31");
  });

  it("returns null without a period end", () => {
    expect(bkmvCoverageEnd(null, new Date(2026, 4, 7))).toBeNull();
  });

  it("falls back to period_end_date when the upload date is missing", () => {
    expect(bkmvCoverageEnd("2026-06-30", null)).toBe("2026-06-30");
  });
});

describe("bkmvPeriodDueThrough", () => {
  const aug17 = new Date(2026, 7, 17);

  it("demands a closed period in full", () => {
    expect(bkmvPeriodDueThrough("2026-04-01", "2026-06-30", aug17)).toBe(
      "2026-06-30"
    );
  });

  it("demands only the elapsed months of the running quarter", () => {
    // Q3 on 17/08: July is done, August isn't.
    expect(bkmvPeriodDueThrough("2026-07-01", "2026-09-30", aug17)).toBe(
      "2026-07-31"
    );
  });

  it("demands nothing from the running month", () => {
    expect(bkmvPeriodDueThrough("2026-08-01", "2026-08-31", aug17)).toBeNull();
  });

  it("demands the elapsed part of the running calendar year", () => {
    expect(bkmvPeriodDueThrough("2026-01-01", "2026-12-31", aug17)).toBe(
      "2026-07-31"
    );
  });
});
