import { describe, expect, it } from "vitest";

import {
  calculateCanonicalApproval,
  canonicalStoredDecimal,
  validateApprovalCalculation,
  type ApprovalCalculationRow,
  type ApprovalFinancialField,
} from "@/lib/franchisee-billing-approval";

const config = {
  tiers: [{ upTo: null, rate: 5 }],
  tierBasis: "gross" as const,
  marketingRate: 0.75,
  vat: 0.18,
};

function validRow(): ApprovalCalculationRow {
  const inputs = {
    receipts: canonicalStoredDecimal(1180.123456, 6),
    tips: canonicalStoredDecimal(0, 6),
    includeTips: false,
    discountRatePoints: canonicalStoredDecimal(1, 2),
  };
  return {
    ...inputs,
    ...calculateCanonicalApproval({
      ...inputs,
      grossBase: "0",
      netBase: "0",
      tierRate: "0",
      effectiveRate: "0",
      royaltyFull: "0",
      royalty: "0",
      discountValue: "0",
      marketing: "0",
      subtotal: "0",
      total: "0",
    }, config),
  };
}

const moneyFields = [
  "grossBase",
  "netBase",
  "royaltyFull",
  "royalty",
  "discountValue",
  "marketing",
  "subtotal",
  "total",
] as const satisfies readonly ApprovalFinancialField[];
const rateFields = [
  "tierRate",
  "effectiveRate",
] as const satisfies readonly ApprovalFinancialField[];

describe("validateApprovalCalculation", () => {
  it("accepts only a row identical to a fresh royalty calculation", () => {
    const row = validRow();

    expect(validateApprovalCalculation(row, config)).toEqual({
      success: true,
      calculation: calculateCanonicalApproval(row, config),
    });
  });

  it.each([
    ...moneyFields.map((field) => ({ field, scale: 6 })),
    ...rateFields.map((field) => ({ field, scale: 2 })),
  ])("rejects an exact mismatch in $field", ({ field, scale }) => {
    const row = validRow();
    const changed = {
      ...row,
      [field]: canonicalStoredDecimal(
        Number(row[field]) + 1 / (10 ** scale),
        scale,
      ),
    };

    expect(validateApprovalCalculation(changed, config)).toMatchObject({
      success: false,
      mismatch: {
        field,
        stored: changed[field],
        calculated: row[field],
      },
    });
  });

  it("rejects values calculated with an obsolete marketing rate", () => {
    const row = validRow();

    expect(validateApprovalCalculation(row, {
      ...config,
      marketingRate: config.marketingRate + 0.25,
    })).toMatchObject({
      success: false,
      mismatch: { field: "marketing" },
    });
  });
});
