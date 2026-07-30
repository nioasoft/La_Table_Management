import { describe, expect, it } from "vitest";

import { canSetNoRevenueReason } from "@/components/franchisee-billing-no-revenue-cell";

describe("franchisee billing no-revenue control", () => {
  it("is editable only for a draft with all three amounts at zero", () => {
    expect(canSetNoRevenueReason({
      status: "draft",
      royalty: "0.000000",
      marketing: "0",
      total: "0.000000",
    })).toBe(true);
  });

  it.each([
    { status: "approved" as const, royalty: "0", marketing: "0", total: "0" },
    { status: "draft" as const, royalty: "1", marketing: "0", total: "1.18" },
    { status: "draft" as const, royalty: "0", marketing: "1", total: "1.18" },
    { status: "draft" as const, royalty: "0", marketing: "0", total: "1.18" },
  ])("is disabled for approved or nonzero billing data", (row) => {
    expect(canSetNoRevenueReason(row)).toBe(false);
  });
});
