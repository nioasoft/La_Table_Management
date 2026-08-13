import { describe, it, expect } from "vitest";
import { fileBelongsInExportRange } from "../settlement-periods";

const Q2 = { start: "2026-04-01", end: "2026-06-30" };
const Q3 = { start: "2026-07-01", end: "2026-09-30" };
const JUNE = { start: "2026-06-01", end: "2026-06-30" };

describe("fileBelongsInExportRange", () => {
  it("quarterly run: monthly supplier contributes every month in range", () => {
    // Was last-month-only until 2026-08 — April+May vanished from the export
    // instead of showing up as their own rows.
    expect(fileBelongsInExportRange("monthly", "2026-04-01", Q2.start, Q2.end)).toBe(true);
    expect(fileBelongsInExportRange("monthly", "2026-05-01", Q2.start, Q2.end)).toBe(true);
    expect(fileBelongsInExportRange("monthly", "2026-06-01", Q2.start, Q2.end)).toBe(true);
  });

  it("quarterly run reaches a month with no later file (אברהמי July in Q3)", () => {
    // Only a July file exists; last-month-only kept September and exported nothing
    expect(fileBelongsInExportRange("monthly", "2026-07-01", Q3.start, Q3.end)).toBe(true);
  });

  it("quarterly run: quarterly/semi-annual/annual suppliers keep overlap semantics", () => {
    expect(fileBelongsInExportRange("quarterly", "2026-04-01", Q2.start, Q2.end)).toBe(true);
    expect(fileBelongsInExportRange("semi_annual", "2026-01-01", Q2.start, Q2.end)).toBe(true);
    expect(fileBelongsInExportRange("annual", "2026-01-01", Q2.start, Q2.end)).toBe(true);
  });

  it("monthly run: only monthly-or-faster suppliers appear", () => {
    expect(fileBelongsInExportRange("monthly", "2026-06-01", JUNE.start, JUNE.end)).toBe(true);
    expect(fileBelongsInExportRange("bi_weekly", "2026-06-01", JUNE.start, JUNE.end)).toBe(true);
    expect(fileBelongsInExportRange("quarterly", "2026-04-01", JUNE.start, JUNE.end)).toBe(false);
    expect(fileBelongsInExportRange("annual", "2026-01-01", JUNE.start, JUNE.end)).toBe(false);
  });

  it("null frequency is treated as monthly (schema default)", () => {
    expect(fileBelongsInExportRange(null, "2026-04-01", Q2.start, Q2.end)).toBe(true);
    expect(fileBelongsInExportRange(null, "2026-06-01", Q2.start, Q2.end)).toBe(true);
    expect(fileBelongsInExportRange(null, "2026-06-01", JUNE.start, JUNE.end)).toBe(true);
  });
});
