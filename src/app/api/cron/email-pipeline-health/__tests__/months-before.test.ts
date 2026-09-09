import { describe, it, expect } from "vitest";
import { monthsBefore } from "../route";

/**
 * Human months (1-12) throughout — `toISOString()` arithmetic shifts an
 * Israeli date back a day and, at a month boundary, a whole month.
 */
describe("monthsBefore", () => {
  it("steps back inside the same year", () => {
    expect(monthsBefore({ m: 9, y: 2026 }, 1)).toEqual({ m: 8, y: 2026 });
    expect(monthsBefore({ m: 9, y: 2026 }, 2)).toEqual({ m: 7, y: 2026 });
  });

  it("crosses the year boundary", () => {
    expect(monthsBefore({ m: 1, y: 2026 }, 1)).toEqual({ m: 12, y: 2025 });
    expect(monthsBefore({ m: 1, y: 2026 }, 2)).toEqual({ m: 11, y: 2025 });
    expect(monthsBefore({ m: 2, y: 2026 }, 3)).toEqual({ m: 11, y: 2025 });
  });

  it("handles a full year and December", () => {
    expect(monthsBefore({ m: 12, y: 2026 }, 1)).toEqual({ m: 11, y: 2026 });
    expect(monthsBefore({ m: 6, y: 2026 }, 12)).toEqual({ m: 6, y: 2025 });
    expect(monthsBefore({ m: 1, y: 2026 }, 13)).toEqual({ m: 12, y: 2024 });
  });

  it("returns the same month for zero", () => {
    expect(monthsBefore({ m: 5, y: 2026 }, 0)).toEqual({ m: 5, y: 2026 });
  });
});
