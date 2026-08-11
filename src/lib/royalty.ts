// Keep this module import-free: reusing calculateNetFromGross from
// file-processor.ts would pull vatRates and the database client into this graph.

export interface RoyaltyTier {
  readonly upTo: number | null;
  readonly rate: number;
  /** Charge this tier's rate on the slice above the previous threshold only. */
  readonly marginal?: boolean;
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
 * The blended percentage of a marginal scale: every band up to and including
 * the selected one charged at its own rate, expressed as one rate of netBase.
 *
 * Reporting a blended rate rather than the top band's headline rate keeps
 * `royaltyFull = netBase * tierRate / 100` true, which the billing email and
 * the Hashavshevet export both rely on.
 */
function blendedRate(
  tiers: readonly RoyaltyTier[],
  selectedIndex: number,
  netBase: number,
  tierBasis: RoyaltyTierBasis,
  vat: number,
): number {
  // Thresholds are entered in one basis, but bands are always charged on net.
  const netEdge = (upTo: number) =>
    tierBasis === "net" ? upTo : upTo / (1 + vat);
  const charged = tiers
    .slice(0, selectedIndex + 1)
    .reduce((sum, tier, index) => {
      const previousUpTo = tiers[index - 1]?.upTo ?? 0;
      const lower = Math.min(netBase, netEdge(previousUpTo));
      const upper =
        tier.upTo === null ? netBase : Math.min(netBase, netEdge(tier.upTo));
      return sum + ((upper - lower) * tier.rate) / 100;
    }, 0);
  return (charged / netBase) * 100;
}

/**
 * Calculates one franchisee royalty and marketing charge without I/O or rounding.
 */
export function calculateRoyalty(
  input: CalculateRoyaltyInput,
): RoyaltyCalculation {
  const { receipts, tips, includeTips, tiers } = input;
  const { tierBasis, marketingRate, discountRatePoints, vat } = input;
  // Tabit's `סה"כ תקבולים` already contains the tips. A franchisee billed on
  // tips therefore takes the column as it stands, and one billed without them
  // has them subtracted — adding them would count the tips twice.
  const grossBase = includeTips ? receipts : receipts - tips;
  const netBase = grossBase / (1 + vat);

  // Intentionally select the tier on gross, then apply its rate to net.
  const selectedIndex = tiers.findIndex((tier) => {
    if (tier.upTo === null) return true;
    const threshold =
      tierBasis === "net" ? tier.upTo * (1 + vat) : tier.upTo;
    return grossBase <= threshold;
  });
  const selectedTier: RoyaltyTier | undefined = tiers[selectedIndex];
  if (!selectedTier) {
    throw new Error(
      `No matching royalty tier for grossBase=${grossBase}, tierBasis=${tierBasis}, tiersChecked=${tiers.length}`,
    );
  }
  // A marginal tier charges every band below it separately; a flat one takes
  // the identical path as before, so non-marginal scales cannot drift.
  const tierRate =
    selectedTier.marginal && netBase > 0
      ? blendedRate(tiers, selectedIndex, netBase, tierBasis, vat)
      : selectedTier.rate;
  // The discount is percentage points off the rate, not a percent of royalty.
  const effectiveRate = Math.max(0, tierRate - discountRatePoints);
  const royaltyFull = (netBase * tierRate) / 100;
  const royalty = (netBase * effectiveRate) / 100;
  const discountValue = royaltyFull - royalty;
  const marketing = (netBase * marketingRate) / 100;
  const subtotal = royalty + marketing;
  const total = subtotal * (1 + vat);

  return {
    grossBase,
    netBase,
    tierRate,
    effectiveRate,
    royaltyFull,
    royalty,
    discountValue,
    marketing,
    subtotal,
    total,
  };
}
