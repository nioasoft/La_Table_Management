import { describe, it, expect } from "vitest";
import { mirrorAmounts } from "../client-reconciliation-mirror";

describe("mirrorAmounts", () => {
  it("compares normally when both sides exist", () => {
    expect(mirrorAmounts("WOLT", 1000, 1020)).toEqual({
      clientAmount: 1000,
      tabitAmount: 1020,
      autoOk: true,
    });
    expect(mirrorAmounts("WOLT", 1000, 1100).autoOk).toBe(false);
  });

  it("fills the client column from Tabit for Tabit-only clients", () => {
    for (const code of ["GIFTCARD", "LATABLE", "LATABLEMARK"]) {
      expect(mirrorAmounts(code, null, 947)).toEqual({
        clientAmount: 947,
        tabitAmount: 947,
        autoOk: true,
      });
    }
  });

  it("fills the Tabit column from the client report for HEVER", () => {
    expect(mirrorAmounts("HEVER", 324885, null)).toEqual({
      clientAmount: 324885,
      tabitAmount: 324885,
      autoOk: true,
    });
  });

  it("never mirrors in the direction the client does not have", () => {
    // A stray Tabit row for HEVER must not auto-approve a missing report.
    expect(mirrorAmounts("HEVER", null, 500).autoOk).toBe(false);
    expect(mirrorAmounts("GIFTCARD", 500, null).autoOk).toBe(false);
  });

  it("leaves an ordinary client with one missing side alone", () => {
    expect(mirrorAmounts("MISHLOCHA", 1000, null)).toEqual({
      clientAmount: 1000,
      tabitAmount: null,
      autoOk: false,
    });
    expect(mirrorAmounts(null, null, null).autoOk).toBe(false);
  });
});
