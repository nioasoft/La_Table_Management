// Keep this module import-free: reusing calculateNetFromGross from
// file-processor.ts would pull vatRates and the database client into this graph.

export interface RoyaltyTier {
  readonly upTo: number | null;
  readonly rate: number;
}

export type RoyaltyTierBasis = "gross" | "net";

export interface CalculateRoyaltyInput {
  readonly receipts: number;
  readonly tips: number;
  readonly includeTips: boolean;
  readonly tiers: readonly RoyaltyTier[];
  readonly tierBasis: RoyaltyTierBasis;
  readonly marketingRate: number;
  readonly discountRatePoints: number;
  readonly vat: number;
}

export interface RoyaltyCalculation {
  readonly grossBase: number;
  readonly netBase: number;
  readonly tierRate: number;
  readonly effectiveRate: number;
  readonly royaltyFull: number;
  readonly royalty: number;
  readonly discountValue: number;
  readonly marketing: number;
  readonly subtotal: number;
  readonly total: number;
}

/**
 * Calculates one franchisee royalty and marketing charge without I/O or rounding.
 */
export function calculateRoyalty(
  input: CalculateRoyaltyInput,
): RoyaltyCalculation {
  const { receipts, tips, includeTips, tiers } = input;
  const { tierBasis, marketingRate, discountRatePoints, vat } = input;
  const grossBase = receipts + (includeTips ? tips : 0);
  const netBase = grossBase / (1 + vat);

  // Intentionally select the tier on gross, then apply its rate to net.
  const selectedTier = tiers.find((tier) => {
    if (tier.upTo === null) return true;
    const threshold =
      tierBasis === "net" ? tier.upTo * (1 + vat) : tier.upTo;
    return grossBase <= threshold;
  });
  if (!selectedTier) {
    throw new Error(
      `No matching royalty tier for grossBase=${grossBase}, tierBasis=${tierBasis}, tiersChecked=${tiers.length}`,
    );
  }
  // The discount is percentage points off the rate, not a percent of royalty.
  const effectiveRate = Math.max(
    0,
    selectedTier.rate - discountRatePoints,
  );
  const royaltyFull = (netBase * selectedTier.rate) / 100;
  const royalty = (netBase * effectiveRate) / 100;
  const discountValue = royaltyFull - royalty;
  const marketing = (netBase * marketingRate) / 100;
  const subtotal = royalty + marketing;
  const total = subtotal * (1 + vat);

  return {
    grossBase,
    netBase,
    tierRate: selectedTier.rate,
    effectiveRate,
    royaltyFull,
    royalty,
    discountValue,
    marketing,
    subtotal,
    total,
  };
}
