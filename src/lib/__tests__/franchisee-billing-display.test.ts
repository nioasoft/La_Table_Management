import { describe, expect, it } from "vitest";

import { discountValueForPoints } from "@/lib/franchisee-billing-display";

describe("discountValueForPoints", () => {
  it("converts percentage points to shekels without rounding", () => {
    expect(discountValueForPoints("626812.345678", 0.5)).toBe(
      3134.06172839,
    );
  });
});
