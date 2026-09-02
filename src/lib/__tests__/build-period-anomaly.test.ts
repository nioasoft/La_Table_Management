import { describe, it, expect } from "vitest";
import { buildPeriodAnomaly } from "@/lib/settlement-periods";

const Q2 = { start: "2026-04-01", end: "2026-06-30" };

describe("buildPeriodAnomaly", () => {
  it("stays quiet when every row falls inside the chosen period", () => {
    const dates = [new Date(2026, 3, 1), new Date(2026, 5, 30)];
    expect(buildPeriodAnomaly(dates, Q2.start, Q2.end)).toBeNull();
  });

  it("flags a file whose rows sit in the previous quarter", () => {
    const dates = [new Date(2026, 0, 15), new Date(2026, 2, 31)];
    const a = buildPeriodAnomaly(dates, Q2.start, Q2.end)!;
    expect(a.code).toBe("PERIOD_MISMATCH");
    expect(a.severity).toBe("warning");
    expect(a.details!.rowsOutside).toBe(2);
    expect(a.details!.fileRange).toBe("2026-01-15 — 2026-03-31");
  });

  it("counts a partial spill rather than calling the whole file wrong", () => {
    const dates = [new Date(2026, 3, 10), new Date(2026, 6, 1)];
    const a = buildPeriodAnomaly(dates, Q2.start, Q2.end)!;
    expect(a.details!.rowsOutside).toBe(1);
    expect(a.details!.rowsTotal).toBe(2);
  });

  // The last day of the period is inside it — an end-of-quarter row is the
  // most common row there is, and comparing against midnight would reject it.
  it("keeps a row dated on the closing day", () => {
    expect(buildPeriodAnomaly([new Date(2026, 5, 30, 23, 30)], Q2.start, Q2.end)).toBeNull();
  });

  it("says so, at info level, when the file carries no dates at all", () => {
    const a = buildPeriodAnomaly([null, undefined], Q2.start, Q2.end)!;
    expect(a.code).toBe("DATES_NOT_EXTRACTED");
    expect(a.severity).toBe("info");
  });

  it("defers to a parser that already raised its own period anomaly", () => {
    expect(buildPeriodAnomaly([null], Q2.start, Q2.end, true)).toBeNull();
  });
});
