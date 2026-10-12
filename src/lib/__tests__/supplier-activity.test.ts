import { describe, it, expect } from "vitest";
import { supplierOwesPeriod, inactiveFromError } from "../supplier-activity";

describe("supplierOwesPeriod", () => {
  const q3 = "2026-07-01";

  it("active supplier owes every period", () => {
    expect(supplierOwesPeriod({ isActive: true, inactiveFrom: null }, q3)).toBe(true);
  });

  it("inactive with no date owes nothing", () => {
    expect(supplierOwesPeriod({ isActive: false, inactiveFrom: null }, q3)).toBe(false);
  });

  it("owes the period that started before the inactive date (incl. partial)", () => {
    expect(supplierOwesPeriod({ isActive: false, inactiveFrom: "2026-10-01" }, q3)).toBe(true);
    expect(supplierOwesPeriod({ isActive: false, inactiveFrom: "2026-08-15" }, q3)).toBe(true);
  });

  it("does not owe a period starting on/after the inactive date", () => {
    expect(supplierOwesPeriod({ isActive: false, inactiveFrom: "2026-07-01" }, q3)).toBe(false);
    expect(supplierOwesPeriod({ isActive: false, inactiveFrom: "2026-06-01" }, q3)).toBe(false);
  });

  it("undated period of an inactive supplier is not owed", () => {
    expect(supplierOwesPeriod({ isActive: false, inactiveFrom: "2026-10-01" }, null)).toBe(false);
  });
});

describe("inactiveFromError", () => {
  it("requires a date for an inactive supplier", () => {
    expect(inactiveFromError(false, null)).not.toBeNull();
    expect(inactiveFromError(false, "")).not.toBeNull();
    expect(inactiveFromError(false, "2026-07-01")).toBeNull();
  });
  it("active supplier needs no date", () => {
    expect(inactiveFromError(true, null)).toBeNull();
  });
  it("rejects a malformed date", () => {
    expect(inactiveFromError(false, "01/07/2026")).not.toBeNull();
  });
});
