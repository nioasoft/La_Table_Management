import { describe, it, expect } from "vitest";
import {
  getAvailablePeriodsForSupplier,
  getPeriodsForFrequency,
} from "../settlement-periods";

// Mid-Q3 2026: Q3 hasn't closed yet, but Reut may want to invoice a supplier
// she's already finished with (see supplier-files period selector).
const MID_Q3 = new Date(2026, 8, 6); // 2026-09-06

describe("getAvailablePeriodsForSupplier — in-progress period", () => {
  it("offers the quarter we're inside, flagged and never first-by-default", () => {
    const periods = getAvailablePeriodsForSupplier("quarterly", MID_Q3);

    const q3 = periods.find((p) => p.key === "2026-Q3");
    expect(q3?.inProgress).toBe(true);

    // The default the UI picks is the first period that is NOT in progress.
    const uiDefault = periods.find((p) => !p.inProgress);
    expect(uiDefault?.key).toBe("2026-Q2");
  });

  it("still excludes periods that haven't started", () => {
    const periods = getAvailablePeriodsForSupplier("quarterly", MID_Q3);
    expect(periods.some((p) => p.key === "2026-Q4")).toBe(false);
  });

  it("flags the current month for monthly suppliers", () => {
    const periods = getAvailablePeriodsForSupplier("monthly", MID_Q3);
    expect(periods.find((p) => p.key === "2026-09")?.inProgress).toBe(true);
    expect(periods.find((p) => !p.inProgress)?.key).toBe("2026-08");
  });
});

// The Hashavshevet export builds its dropdown from getPeriodsForFrequency, so
// the flag has to survive that path too (report-period-selector.tsx).
describe("getPeriodsForFrequency — in-progress flag", () => {
  it("flags the running quarter when includeCurrent is on, and only it", () => {
    const periods = getPeriodsForFrequency("quarterly", MID_Q3, 4, 1, true);

    expect(periods[0].key).toBe("2026-Q3");
    expect(periods[0].inProgress).toBe(true);
    expect(periods.filter((p) => p.inProgress)).toHaveLength(1);

    // What the report selector defaults to.
    expect(periods.find((p) => !p.inProgress)?.key).toBe("2026-Q2");
  });

  it("flags nothing when includeCurrent is off", () => {
    const periods = getPeriodsForFrequency("quarterly", MID_Q3, 4, 1, false);
    expect(periods.some((p) => p.inProgress)).toBe(false);
    expect(periods[0].key).toBe("2026-Q2");
  });
});
