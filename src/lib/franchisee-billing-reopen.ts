import type {
  DifferenceResolutionContext,
  ReopenableBilling,
  ReopenedBillingValues,
} from "@/data-access/franchisee-billing-screen";
import {
  calculateRoyalty,
  type RoyaltyCalculation,
  type RoyaltyTier,
  type RoyaltyTierBasis,
} from "@/lib/royalty";

interface StoredDifference {
  readonly field: string;
  readonly approvedValue: unknown;
  readonly uploadedValue: unknown;
}

interface ReopenCandidate {
  readonly receipts: number;
  readonly tips: number;
  readonly includeTips: boolean;
  readonly tiers: readonly RoyaltyTier[];
  readonly tierBasis: RoyaltyTierBasis;
  readonly marketingRate: number;
  readonly discountRatePoints: number;
  readonly vat: number;
  readonly calculation: RoyaltyCalculation;
}

const CALCULATION_FIELDS = [
  "grossBase",
  "netBase",
  "tierRate",
  "effectiveRate",
  "royaltyFull",
  "royalty",
  "discountValue",
  "marketing",
  "subtotal",
  "total",
] as const;

const ALL_REVIEW_FIELDS = [
  "receipts",
  "tips",
  "includeTips",
  "tiersSnapshot",
  "tierBasisSnapshot",
  "marketingRateSnapshot",
  "vatRateSnapshot",
  "discountRatePoints",
  ...CALCULATION_FIELDS,
] as const;

type ReviewField = (typeof ALL_REVIEW_FIELDS)[number];

function isReviewField(value: string): value is ReviewField {
  return ALL_REVIEW_FIELDS.some((field) => field === value);
}

function finiteNumber(value: unknown): number | null {
  if (typeof value !== "number" && typeof value !== "string") return null;
  if (
    typeof value === "string" &&
    !/^-?(?:\d+\.?\d*|\.\d+)$/.test(value.trim())
  ) {
    return null;
  }
  const parsed = Number(value);
  return Number.isFinite(parsed) ? parsed : null;
}

function royaltyTiers(value: unknown): readonly RoyaltyTier[] | null {
  if (!Array.isArray(value) || value.length === 0) return null;
  const parsed = value.map((tier): RoyaltyTier | null => {
    if (typeof tier !== "object" || tier === null) return null;
    if (!("upTo" in tier) || !("rate" in tier)) return null;
    const upTo = tier.upTo === null ? null : finiteNumber(tier.upTo);
    const rate = finiteNumber(tier.rate);
    if (rate === null || rate < 0 || (tier.upTo !== null && upTo === null)) {
      return null;
    }
    // Strict `=== true` so junk JSON degrades to the flat default rather than
    // silently switching a scale to marginal.
    const marginal =
      "marginal" in tier && tier.marginal === true ? { marginal: true } : {};
    return { upTo, rate, ...marginal };
  });
  return parsed.every((tier): tier is RoyaltyTier => tier !== null)
    ? parsed
    : null;
}

function sameNumber(left: unknown, right: unknown): boolean {
  const leftNumber = finiteNumber(left);
  const rightNumber = finiteNumber(right);
  return (
    leftNumber !== null &&
    rightNumber !== null &&
    Math.abs(leftNumber - rightNumber) <
      0.0000005 + Number.EPSILON
  );
}

function sameTiers(left: unknown, right: unknown): boolean {
  const leftTiers = royaltyTiers(left);
  const rightTiers = royaltyTiers(right);
  return (
    leftTiers !== null &&
    rightTiers !== null &&
    leftTiers.length === rightTiers.length &&
    leftTiers.every(
      (tier, index) =>
        tier.upTo === rightTiers[index]?.upTo &&
        tier.rate === rightTiers[index]?.rate &&
        // `?? false` — an absent key and an explicit false are the same scale.
        (tier.marginal ?? false) === (rightTiers[index]?.marginal ?? false),
    )
  );
}

function currentValue(
  billing: ReopenableBilling,
  field: ReviewField,
): unknown {
  if (field === "tiersSnapshot") return billing.tiersSnapshot;
  if (field === "tierBasisSnapshot") return billing.tierBasisSnapshot;
  if (field === "marketingRateSnapshot") {
    return billing.marketingRateSnapshot;
  }
  if (field === "vatRateSnapshot") return billing.vatRateSnapshot;
  return billing[field];
}

function candidateValue(
  candidate: ReopenCandidate,
  field: ReviewField,
): unknown {
  if (field === "tiersSnapshot") return candidate.tiers;
  if (field === "tierBasisSnapshot") return candidate.tierBasis;
  if (field === "marketingRateSnapshot") return candidate.marketingRate;
  if (field === "vatRateSnapshot") return candidate.vat;
  if (field === "discountRatePoints") {
    return candidate.discountRatePoints;
  }
  if (field === "receipts" || field === "tips" || field === "includeTips") {
    return candidate[field];
  }
  return candidate.calculation[field];
}

function sameSemanticValue(
  field: ReviewField,
  left: unknown,
  right: unknown,
): boolean {
  if (field === "includeTips") {
    return typeof left === "boolean" && left === right;
  }
  if (field === "tiersSnapshot") return sameTiers(left, right);
  if (field === "tierBasisSnapshot") {
    return (left === "gross" || left === "net") && left === right;
  }
  return sameNumber(left, right);
}

function differenceMap(
  differences: readonly StoredDifference[],
): ReadonlyMap<ReviewField, StoredDifference> | null {
  if (differences.length === 0) return null;
  const entries: [ReviewField, StoredDifference][] = [];
  for (const difference of differences) {
    if (!isReviewField(difference.field)) return null;
    if (entries.some(([field]) => field === difference.field)) return null;
    entries.push([difference.field, difference]);
  }
  return new Map(entries);
}

function uploadedOrCurrent(
  differences: ReadonlyMap<ReviewField, StoredDifference>,
  billing: ReopenableBilling,
  field: ReviewField,
): unknown {
  return differences.get(field)?.uploadedValue ?? currentValue(billing, field);
}

function buildCandidate(
  billing: ReopenableBilling,
  differences: ReadonlyMap<ReviewField, StoredDifference>,
): ReopenCandidate | null {
  const receipts = finiteNumber(
    uploadedOrCurrent(differences, billing, "receipts"),
  );
  const tips = finiteNumber(uploadedOrCurrent(differences, billing, "tips"));
  const includeTips = uploadedOrCurrent(
    differences,
    billing,
    "includeTips",
  );
  const tiers = royaltyTiers(
    uploadedOrCurrent(differences, billing, "tiersSnapshot"),
  );
  const tierBasis = uploadedOrCurrent(
    differences,
    billing,
    "tierBasisSnapshot",
  );
  const marketingRate = finiteNumber(
    uploadedOrCurrent(differences, billing, "marketingRateSnapshot"),
  );
  const discountRatePoints = finiteNumber(
    uploadedOrCurrent(differences, billing, "discountRatePoints"),
  );
  const vat = finiteNumber(
    uploadedOrCurrent(differences, billing, "vatRateSnapshot"),
  );
  if (
    receipts === null ||
    tips === null ||
    typeof includeTips !== "boolean" ||
    tiers === null ||
    (tierBasis !== "gross" && tierBasis !== "net") ||
    marketingRate === null ||
    marketingRate < 0 ||
    discountRatePoints === null ||
    discountRatePoints < 0 ||
    vat === null ||
    vat < 0
  ) {
    return null;
  }
  try {
    const calculation = calculateRoyalty({
      receipts,
      tips,
      includeTips,
      tiers,
      tierBasis,
      marketingRate,
      discountRatePoints,
      vat,
    });
    if (discountRatePoints > calculation.tierRate) return null;
    return {
      receipts,
      tips,
      includeTips,
      tiers,
      tierBasis,
      marketingRate,
      discountRatePoints,
      vat,
      calculation,
    };
  } catch {
    return null;
  }
}

function reviewMatchesCandidate(
  billing: ReopenableBilling,
  candidate: ReopenCandidate,
  differences: ReadonlyMap<ReviewField, StoredDifference>,
): boolean {
  for (const [field, difference] of differences) {
    if (
      !sameSemanticValue(
        field,
        difference.approvedValue,
        currentValue(billing, field),
      ) ||
      !sameSemanticValue(
        field,
        difference.uploadedValue,
        candidateValue(candidate, field),
      )
    ) {
      return false;
    }
  }
  return ALL_REVIEW_FIELDS.every((field) => {
    const changed = !sameSemanticValue(
      field,
      currentValue(billing, field),
      candidateValue(candidate, field),
    );
    return !changed || differences.has(field);
  });
}

/**
 * Rebuilds a corrected draft with the canonical royalty engine.
 */
export function buildReopenedBilling(
  context: DifferenceResolutionContext,
  sourceFileId: string,
  storedDifferences: readonly StoredDifference[],
): ReopenedBillingValues | null {
  const differences = differenceMap(storedDifferences);
  if (!differences) return null;
  const candidate = buildCandidate(context.billing, differences);
  if (
    !candidate ||
    !reviewMatchesCandidate(context.billing, candidate, differences)
  ) {
    return null;
  }
  const { billing } = context;
  const calculation = candidate.calculation;
  return {
    billingId: billing.id,
    franchiseeId: billing.franchiseeId,
    periodYear: billing.periodYear,
    periodMonth: billing.periodMonth,
    receipts: String(candidate.receipts),
    tips: String(candidate.tips),
    includeTips: candidate.includeTips,
    grossBase: String(calculation.grossBase),
    netBase: String(calculation.netBase),
    tierRate: String(calculation.tierRate),
    discountRatePoints: String(candidate.discountRatePoints),
    effectiveRate: String(calculation.effectiveRate),
    royaltyFull: String(calculation.royaltyFull),
    royalty: String(calculation.royalty),
    discountValue: String(calculation.discountValue),
    marketing: String(calculation.marketing),
    subtotal: String(calculation.subtotal),
    total: String(calculation.total),
    sourceFileId,
  };
}
