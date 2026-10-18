import { describe, it, expect } from "vitest";
import { snapPeriodToFrequency } from "../settlement-periods";

// Upload-link files take their period from the row dates (min..max). For a
// quarterly supplier that produced "יולי-אוג׳" (עלה עלה, 2026-07-01..08-01) and
// "יולי-יולי" (פרסקו, 2026-07-01..07-16) in the reconciliation period picker.
describe("snapPeriodToFrequency", () => {
  it("snaps a partial-quarter date range to its quarter", () => {
    expect(snapPeriodToFrequency("2026-07-01", "2026-08-01", "quarterly")).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-09-30",
      snapped: true,
    });
    expect(snapPeriodToFrequency("2026-07-01", "2026-07-16", "quarterly").endDate).toBe("2026-09-30");
  });

  it("leaves a full quarter untouched", () => {
    expect(snapPeriodToFrequency("2026-07-01", "2026-09-30", "quarterly")).toEqual({
      startDate: "2026-07-01",
      endDate: "2026-09-30",
      snapped: false,
    });
  });
});
