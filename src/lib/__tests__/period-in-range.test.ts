import { describe, expect, it } from "vitest";
import { formatDateAsLocal, periodInRange } from "../date-utils";
import { getPeriodByKey } from "../settlement-periods";

describe("periodInRange", () => {
  it("keeps everything, undated rows included, when no range is picked", () => {
    expect(periodInRange("2026-07-01", "2026-07-31", "", "")).toBe(true);
    expect(periodInRange(null, null, "", "")).toBe(true);
  });

  it("hides undated rows once any bound is set", () => {
    expect(periodInRange(null, null, "2026-07-01", "")).toBe(false);
    expect(periodInRange(null, null, "", "2026-09-30")).toBe(false);
  });

  it("matches by inclusive overlap, not exact keys", () => {
    const [from, to] = ["2026-07-01", "2026-09-30"]; // Q3
    expect(periodInRange("2026-08-01", "2026-08-31", from, to)).toBe(true); // month inside
    expect(periodInRange("2026-01-01", "2026-12-31", from, to)).toBe(true); // year around it
    expect(periodInRange("2026-06-01", "2026-07-01", from, to)).toBe(true); // touches start
    expect(periodInRange("2026-09-30", "2026-10-31", from, to)).toBe(true); // touches end
    expect(periodInRange("2026-04-01", "2026-06-30", from, to)).toBe(false); // Q2
    expect(periodInRange("2026-10-01", "2026-10-31", from, to)).toBe(false); // October
  });

  it("treats a missing bound as open-ended", () => {
    expect(periodInRange("2020-01-01", "2020-01-31", "", "2026-09-30")).toBe(true);
    expect(periodInRange("2020-01-01", "2020-01-31", "2026-07-01", "")).toBe(false);
  });
});

describe("period key → filter dates", () => {
  // What the sessions page does with the picker — must not shift a day in UTC+2/3.
  it.each([
    ["2026-07", "2026-07-01", "2026-07-31"],
    ["2026-Q3", "2026-07-01", "2026-09-30"],
    ["2026-H1", "2026-01-01", "2026-06-30"],
  ])("%s → %s..%s", (key, start, end) => {
    const period = getPeriodByKey(key)!;
    expect(formatDateAsLocal(period.startDate)).toBe(start);
    expect(formatDateAsLocal(period.endDate)).toBe(end);
  });
});
