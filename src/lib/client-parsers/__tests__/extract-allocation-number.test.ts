import { describe, it, expect } from "vitest";
import { extractAllocationNumber } from "../extract-allocation-number";

describe("extractAllocationNumber", () => {
  it("extracts an isolated 9-digit number after the label", () => {
    expect(extractAllocationNumber("מספר הקצאה 091097208")).toBe("091097208");
  });

  it("extracts an isolated 9-digit number before the label", () => {
    expect(extractAllocationNumber("091097208\nהקצאה מספר")).toBe("091097208");
  });

  // Regression: ezcount / Hyp-EasyCount glue a 17-digit issue timestamp
  // (YYYYMMDDHHMMSSmmm) directly onto the 9-digit allocation with no
  // separator, which defeated the (?<!\d) boundary in the isolated patterns.
  // Real string from קינג קונג ביג × משלוחה, invoice 10054, May 2026.
  it("extracts the allocation when an ezcount timestamp is glued before it (Mishloha)", () => {
    const text =
      'חשבונית מס מספר 10054\n20260601224523045152063195הקצאה מספר: \nפריטים:';
    expect(extractAllocationNumber(text)).toBe("152063195");
  });

  // Real string from a HAAT ezcount client_report, invoice 10046.
  it("extracts the allocation when an ezcount timestamp is glued before it (HAAT)", () => {
    const text =
      'חשבונית מס מספר 10046\n20260401153109051091056762הקצאה מספר: \nפריטים:';
    expect(extractAllocationNumber(text)).toBe("091056762");
  });

  it("does not extract a stray ח.פ. number that is not next to the label", () => {
    expect(
      extractAllocationNumber('ח.פ. 516229903\nחשבונית מס מספר 10054')
    ).toBeUndefined();
  });

  it("returns undefined when no allocation number is present", () => {
    expect(extractAllocationNumber("חשבונית מס מספר 12345")).toBeUndefined();
  });
});
