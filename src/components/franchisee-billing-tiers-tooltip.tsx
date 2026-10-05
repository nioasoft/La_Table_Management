"use client";

import type { ReactNode } from "react";

import { formatBillingNumber } from "@/components/franchisee-billing-number";
import {
  Tooltip,
  TooltipContent,
  TooltipTrigger,
} from "@/components/ui/tooltip";
import {
  findTierIndex,
  type RoyaltyTier,
  type RoyaltyTierBasis,
} from "@/lib/royalty";

interface TierPosition {
  /** The month's revenue in the scale's own basis — what the thresholds mean. */
  readonly basisAmount: number;
  readonly tierIndex: number;
  /** Shekels short of the next band, in the scale's basis; null on the top band. */
  readonly gapToNext: number | null;
}

/**
 * Where a billed month sits on its royalty scale. The VAT is read back from
 * the row's own gross/net pair, so the band picked here is the one
 * `calculateRoyalty` picked when the row was written.
 */
export function tierPosition(
  tiers: readonly RoyaltyTier[],
  tierBasis: RoyaltyTierBasis,
  grossBase: number,
  netBase: number,
): TierPosition {
  const vat = netBase > 0 ? grossBase / netBase - 1 : 0;
  const basisAmount = tierBasis === "net" ? netBase : grossBase;
  const tierIndex = findTierIndex(tiers, tierBasis, grossBase, vat);
  const upTo = tiers[tierIndex]?.upTo ?? null;
  return {
    basisAmount,
    tierIndex,
    gapToNext: upTo === null ? null : Math.max(0, upTo - basisAmount),
  };
}

interface FranchiseeBillingTiersTooltipProps {
  readonly tiers: readonly RoyaltyTier[] | null | undefined;
  readonly tierBasis: RoyaltyTierBasis | undefined;
  readonly grossBase: string;
  readonly netBase: string;
  readonly children: ReactNode;
}

const money = (value: number) => formatBillingNumber(value, "currency");

function tierLabel(tiers: readonly RoyaltyTier[], index: number): string {
  const tier = tiers[index]!;
  const scope = tier.marginal ? " על ההפרש" : "";
  if (tier.upTo !== null) return `עד ${money(tier.upTo)} — ${tier.rate}%${scope}`;
  const previous = tiers[index - 1]?.upTo;
  return previous === undefined || previous === null
    ? `${tier.rate}% מכל סכום`
    : `מעל ${money(previous)} — ${tier.rate}%${scope}`;
}

/** Hovering a franchisee shows the scale it is billed on and why it got its rate. */
export function FranchiseeBillingTiersTooltip({
  tiers,
  tierBasis = "gross",
  grossBase,
  netBase,
  children,
}: FranchiseeBillingTiersTooltipProps) {
  const position = tiers?.length
    ? tierPosition(tiers, tierBasis, Number(grossBase), Number(netBase))
    : null;
  const nextTier = position ? tiers?.[position.tierIndex + 1] : undefined;

  return (
    <Tooltip>
      <TooltipTrigger asChild>
        <span className="block cursor-help underline decoration-dotted underline-offset-4">
          {children}
        </span>
      </TooltipTrigger>
      <TooltipContent dir="rtl" side="left" className="max-w-xs space-y-2 py-2">
        {!tiers?.length || !position ? (
          <p>אין מדרגות מוגדרות</p>
        ) : (
          <>
            <p className="font-semibold">
              מדרגות תמלוגים · לפי מחזור {tierBasis === "net" ? "נטו" : "ברוטו"}
            </p>
            <ul className="space-y-0.5">
              {tiers.map((tier, index) => (
                <li
                  key={`${tier.upTo ?? "top"}-${index}`}
                  className={
                    index === position.tierIndex
                      ? "font-semibold text-primary"
                      : "text-muted-foreground"
                  }
                >
                  {index === position.tierIndex ? "◀ " : ""}
                  {tierLabel(tiers, index)}
                </li>
              ))}
            </ul>
            <p>מחזור החודש: {money(position.basisAmount)}</p>
            {position.gapToNext !== null && nextTier && (
              <p className="text-muted-foreground">
                חסרים {money(position.gapToNext)} למדרגה הבאה ({nextTier.rate}%)
              </p>
            )}
          </>
        )}
      </TooltipContent>
    </Tooltip>
  );
}
