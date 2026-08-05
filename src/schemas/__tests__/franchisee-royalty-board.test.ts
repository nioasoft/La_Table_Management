import { describe, expect, it } from "vitest";

import {
  blockingReason,
  describeRoyaltyTiers,
  royaltyBoardRowSchema,
  type RoyaltyBoardRow,
} from "../franchisee-royalty-board";

function row(overrides: Partial<RoyaltyBoardRow> = {}): RoyaltyBoardRow {
  return royaltyBoardRowSchema.parse({
    id: "franchisee-1",
    name: "מינה טומאיי יהוד",
    royaltyTiers: [
      { upTo: 700_000, rate: 0 },
      { upTo: null, rate: 5 },
    ],
    royaltyTierBasis: "gross",
    royaltyTiersConfirmed: false,
    royaltyIncludeTips: false,
    marketingFeeRate: "1.00",
    hashavshevetAccountKey: null,
    brand: { nameHe: "מינה טומיי" },
    ...overrides,
  });
}

describe("describeRoyaltyTiers", () => {
  it("reads a multi-tier scale as one line", () => {
    expect(describeRoyaltyTiers(row())).toBe(
      "0% עד 700,000 ₪ · 5% מעבר לכך",
    );
  });

  it("returns null when no scale is configured", () => {
    expect(describeRoyaltyTiers(row({ royaltyTiers: null }))).toBeNull();
  });
});

describe("blockingReason", () => {
  it("clears a franchisee that has a scale and a marketing rate", () => {
    expect(blockingReason(row())).toBeNull();
  });

  it("blocks a missing scale", () => {
    expect(blockingReason(row({ royaltyTiers: [] }))).toBe(
      "לא הוגדר סולם תמלוגים",
    );
  });

  it("blocks a missing marketing rate", () => {
    expect(blockingReason(row({ marketingFeeRate: null }))).toBe(
      "לא הוגדר אחוז שיווק",
    );
  });
});
