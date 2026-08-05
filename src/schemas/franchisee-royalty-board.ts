import { z } from "zod";

/**
 * The subset of `GET /api/franchisees` the royalty confirmation board reads.
 * Passthrough keeps the rest of the franchisee record out of the way.
 */
const royaltyBoardTierSchema = z.object({
  upTo: z.number().nullable(),
  rate: z.number(),
});

export const royaltyBoardRowSchema = z
  .object({
    id: z.string(),
    name: z.string(),
    royaltyTiers: z.array(royaltyBoardTierSchema).nullable(),
    royaltyTierBasis: z.enum(["gross", "net"]).nullable(),
    royaltyTiersConfirmed: z.boolean(),
    royaltyTiersNote: z.string().nullable().optional(),
    royaltyIncludeTips: z.boolean(),
    marketingFeeRate: z.string().nullable(),
    hashavshevetAccountKey: z.string().nullable().optional(),
    brand: z
      .object({ nameHe: z.string().nullable() })
      .nullable()
      .optional(),
  })
  .passthrough();

export const royaltyBoardResponseSchema = z.object({
  franchisees: z.array(royaltyBoardRowSchema),
});

export type RoyaltyBoardRow = z.infer<typeof royaltyBoardRowSchema>;

/** "0% עד 700,000 ₪ · 5% מעבר לכך" — the whole scale in one readable line. */
export function describeRoyaltyTiers(row: RoyaltyBoardRow): string | null {
  if (!row.royaltyTiers?.length) return null;
  // Plain grouping, not currency style: `style: "currency"` injects RLM marks.
  const amount = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 0 });
  return row.royaltyTiers
    .map((tier) =>
      tier.upTo === null
        ? `${tier.rate}% מעבר לכך`
        : `${tier.rate}% עד ${amount.format(tier.upTo)} ₪`,
    )
    .join(" · ");
}

/** Why a scale cannot be confirmed yet, or null when it can. */
export function blockingReason(row: RoyaltyBoardRow): string | null {
  if (!row.royaltyTiers?.length) return "לא הוגדר סולם תמלוגים";
  if (row.marketingFeeRate === null) return "לא הוגדר אחוז שיווק";
  return null;
}
