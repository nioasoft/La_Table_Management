import { z } from "zod";

const royaltyTierSchema = z.strictObject({
  upTo: z.number().nonnegative("רף מדרגה חייב להיות אפס או יותר").nullable(),
  rate: z
    .number()
    .min(0, "אחוז תמלוגים חייב להיות בין 0 ל־100")
    .max(100, "אחוז תמלוגים חייב להיות בין 0 ל־100"),
});

export const franchiseeRoyaltyPatchSchema = z
  .strictObject({
    royaltyTiers: z
      .array(royaltyTierSchema)
      .min(1, "יש להזין לפחות מדרגת תמלוגים אחת"),
    royaltyTierBasis: z.enum(["gross", "net"]),
    royaltyTiersConfirmed: z.boolean(),
    royaltyIncludeTips: z.boolean(),
    hashavshevetAccountKey: z.string().trim().nullable(),
    marketingFeeRate: z
      .number()
      .min(0, "אחוז שיווק חייב להיות בין 0 ל־100")
      .max(100, "אחוז שיווק חייב להיות בין 0 ל־100"),
  })
  .superRefine(({ royaltyTiers }, context) => {
    const lastIndex = royaltyTiers.length - 1;

    royaltyTiers.forEach((tier, index) => {
      if (index === lastIndex && tier.upTo !== null) {
        context.addIssue({
          code: "custom",
          message: "המדרגה האחרונה חייבת להסתיים ללא הגבלה",
          path: ["royaltyTiers", index, "upTo"],
        });
      }

      if (index < lastIndex && tier.upTo === null) {
        context.addIssue({
          code: "custom",
          message: "רק המדרגה האחרונה יכולה להסתיים ללא הגבלה",
          path: ["royaltyTiers", index, "upTo"],
        });
      }

      const previousUpTo = royaltyTiers[index - 1]?.upTo;
      if (
        index > 0 &&
        tier.upTo !== null &&
        previousUpTo !== null &&
        previousUpTo !== undefined &&
        tier.upTo <= previousUpTo
      ) {
        context.addIssue({
          code: "custom",
          message: "רפי המדרגות חייבים להיות ייחודיים ובסדר עולה",
          path: ["royaltyTiers", index, "upTo"],
        });
      }
    });
  });

export type FranchiseeRoyaltyPatch = z.infer<
  typeof franchiseeRoyaltyPatchSchema
>;

/**
 * Validates and serializes the complete royalty settings PATCH payload.
 */
export function serializeFranchiseeRoyaltyPatch(
  input: FranchiseeRoyaltyPatch,
): string {
  return JSON.stringify(franchiseeRoyaltyPatchSchema.parse(input));
}
