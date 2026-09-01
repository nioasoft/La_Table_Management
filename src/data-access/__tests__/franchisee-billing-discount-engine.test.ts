import { describe, expect, it } from "vitest";

import {
  updateBillingDiscount,
  type BillingDiscountContext,
  type BillingScreenOperations,
  type PersistDiscountInput,
} from "@/data-access/franchisee-billing-screen";
import {
  canonicalStoredDecimal,
  validateApprovalCalculation,
  type ApprovalCalculationRow,
} from "@/lib/franchisee-billing-approval";
import { calculateRoyalty, type RoyaltyTier } from "@/lib/royalty";

const TIERS = [{ upTo: null, rate: 5 }] as const;
const VAT = 0.18;

interface OriginalDiscountInputs {
  readonly receipts: string;
  readonly tips: string;
  readonly includeTips: boolean;
  readonly tiers: readonly RoyaltyTier[];
  readonly tierBasis: "gross" | "net";
  readonly marketingRate: string;
}

type CompleteDiscountContext = BillingDiscountContext &
  OriginalDiscountInputs;

function discountContext(): CompleteDiscountContext {
  const originalInputs = {
    receipts: "100000.100000",
    tips: "0.000000",
    includeTips: false,
    tiers: TIERS,
    tierBasis: "gross" as const,
    marketingRate: "1.00",
  };
  return {
    id: "billing-precision",
    periodYear: 2026,
    periodMonth: 6,
    status: "draft",
    ...originalInputs,
  };
}

function expectedCalculation(
  context: CompleteDiscountContext,
  discountRatePoints: number,
) {
  return calculateRoyalty({
    receipts: Number(context.receipts),
    tips: Number(context.tips),
    includeTips: context.includeTips,
    tiers: context.tiers,
    tierBasis: context.tierBasis,
    marketingRate: Number(context.marketingRate),
    discountRatePoints,
    vat: VAT,
  });
}

function operationsFor(context: CompleteDiscountContext) {
  let persisted: PersistDiscountInput | null = null;
  const operations: BillingScreenOperations = {
    readPeriodSnapshot: async () => ({
      rows: [],
      sourcesByBrand: new Map(),
      unlinkedSources: [],
    }),
    readDiscountContext: async () => context,
    readVatRate: async () => VAT,
    persistDiscount: async (input) => {
      persisted = input;
      return true;
    },
    readNoRevenueContext: async () => null,
    persistNoRevenueReason: async () => false,
    readDifferenceContext: async () => null,
    persistDifferenceResolution: async () => "conflict",
    discardSourceFile: async () => "not_found",
    readBillableFranchisees: async () => [],
  };
  return {
    operations,
    persisted: () => persisted,
  };
}

function storedApprovalRow(
  context: CompleteDiscountContext,
  persisted: PersistDiscountInput,
): ApprovalCalculationRow {
  const expected = expectedCalculation(
    context,
    Number(persisted.discountRatePoints),
  );
  return {
    receipts: context.receipts,
    tips: context.tips,
    includeTips: context.includeTips,
    discountRatePoints: canonicalStoredDecimal(
      Number(persisted.discountRatePoints),
      2,
    ),
    grossBase: canonicalStoredDecimal(expected.grossBase, 6),
    netBase: canonicalStoredDecimal(expected.netBase, 6),
    tierRate: canonicalStoredDecimal(expected.tierRate, 2),
    effectiveRate: canonicalStoredDecimal(Number(persisted.effectiveRate), 2),
    royaltyFull: canonicalStoredDecimal(expected.royaltyFull, 6),
    royalty: canonicalStoredDecimal(Number(persisted.royalty), 6),
    discountValue: canonicalStoredDecimal(Number(persisted.discountValue), 6),
    marketing: canonicalStoredDecimal(expected.marketing, 6),
    subtotal: canonicalStoredDecimal(Number(persisted.subtotal), 6),
    total: canonicalStoredDecimal(Number(persisted.total), 6),
  };
}

describe("updateBillingDiscount canonical royalty engine", () => {
  it.each([0, 1])(
    "persists discount %s outputs digit-for-digit from calculateRoyalty",
    async (discountRatePoints) => {
      const context = discountContext();
      const harness = operationsFor(context);
      const expected = expectedCalculation(context, discountRatePoints);

      await expect(updateBillingDiscount(
        context.id,
        discountRatePoints,
        harness.operations,
      )).resolves.toEqual({
        success: true,
        data: {
          discountRatePoints,
          effectiveRate: expected.effectiveRate,
          royalty: expected.royalty,
          discountValue: expected.discountValue,
          subtotal: expected.subtotal,
          total: expected.total,
        },
      });
      expect(harness.persisted()).toEqual({
        billingId: context.id,
        discountRatePoints: String(discountRatePoints),
        effectiveRate: String(expected.effectiveRate),
        royalty: String(expected.royalty),
        discountValue: String(expected.discountValue),
        subtotal: String(expected.subtotal),
        total: String(expected.total),
      });
    },
  );

  it("passes exact approval validation after entering a deferral", async () => {
    const context = discountContext();
    const harness = operationsFor(context);

    await updateBillingDiscount(context.id, 1, harness.operations);
    const persisted = harness.persisted();
    expect(persisted).not.toBeNull();
    if (!persisted) throw new Error("Expected the discount to be persisted");

    expect(validateApprovalCalculation(storedApprovalRow(context, persisted), {
      tiers: context.tiers,
      tierBasis: context.tierBasis,
      marketingRate: Number(context.marketingRate),
      vat: VAT,
    })).toMatchObject({ success: true });
  });

  it("blocks a deferral larger than the canonical tier rate", async () => {
    const context = discountContext();
    const harness = operationsFor(context);

    await expect(updateBillingDiscount(
      context.id,
      5.01,
      harness.operations,
    )).resolves.toMatchObject({
      success: false,
      code: "discount_exceeds_tier",
    });
    expect(harness.persisted()).toBeNull();
  });
});
