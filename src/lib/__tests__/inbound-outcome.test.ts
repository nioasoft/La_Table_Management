import { describe, it, expect } from "vitest";
import { classifyProcessOutcome } from "../inbound-outcome";

describe("classifyProcessOutcome", () => {
  it("counts a stored document as created", () => {
    expect(
      classifyProcessOutcome({ success: true, document: { id: "d1" } }),
    ).toBe("created");
  });

  it("counts a deliberate parser refusal as skipped, not failed", () => {
    // 10bis "הודעת תשלום" remittance advice, Cibus daily snapshot,
    // ezcount receipt — success, nothing to store.
    expect(classifyProcessOutcome({ success: true, document: null })).toBe(
      "skipped",
    );
    expect(classifyProcessOutcome({ success: true })).toBe("skipped");
  });

  it("counts a re-delivery as duplicate", () => {
    expect(
      classifyProcessOutcome({ success: false, skippedDuplicate: true }),
    ).toBe("duplicate");
    // A duplicate wins even when the caller also reports success.
    expect(
      classifyProcessOutcome({
        success: true,
        document: { id: "d1" },
        skippedDuplicate: true,
      }),
    ).toBe("duplicate");
  });

  it("separates an overwrite conflict from an outright failure", () => {
    expect(
      classifyProcessOutcome({ success: false, skippedConflict: true }),
    ).toBe("conflict");
    expect(classifyProcessOutcome({ success: false })).toBe("failed");
  });
});
