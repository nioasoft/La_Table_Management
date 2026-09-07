import { z } from "zod";

/**
 * The yearly grid Reut keeps by hand: one row per branch, twelve month
 * columns, all before VAT. Kept apart from the monthly report schemas because
 * those require a month and a year has none.
 */
export const franchiseeBillingAnnualTypeSchema = z.enum(
  ["turnover", "royalties", "marketing", "discounts"],
  { error: "סוג הדוח אינו תקין" },
);

export const franchiseeBillingAnnualQuerySchema = z.strictObject({
  reportType: franchiseeBillingAnnualTypeSchema,
  // Null means every brand — the schema is fed from URL params, where an
  // absent key arrives as null.
  brandId: z
    .string()
    .trim()
    .min(1, "מזהה המותג אינו תקין")
    .nullish()
    .transform((value) => value ?? null),
  year: z.coerce
    .number()
    .int("שנת הדוח אינה תקינה")
    .min(2020, "שנת הדוח אינה תקינה")
    .max(2100, "שנת הדוח אינה תקינה"),
});

export const franchiseeBillingAnnualRowSchema = z.object({
  franchiseeId: z.string(),
  franchiseeName: z.string(),
  brandName: z.string(),
  /** Twelve cells, January→December. Null is "no billing row", not zero. */
  months: z.array(z.string().nullable()).length(12),
  total: z.string(),
  /** Averaged over months that have data — Excel's AVERAGE() semantics. */
  average: z.string().nullable(),
  /** royalties only: royalty ÷ turnover × 100. Null when turnover is zero. */
  ratePercent: z.string().nullable(),
  /**
   * royalties only: the year's turnover behind the percentage, so brand and
   * group totals recompute it on the sums instead of averaging percentages.
   */
  turnoverTotal: z.string().nullable(),
});

export const franchiseeBillingAnnualPayloadSchema = z.object({
  reportType: franchiseeBillingAnnualTypeSchema,
  year: z.number().int(),
  rows: z.array(franchiseeBillingAnnualRowSchema),
});

export const franchiseeBillingAnnualResponseSchema = z.object({
  success: z.literal(true),
  data: franchiseeBillingAnnualPayloadSchema,
  requestId: z.string(),
});

export type FranchiseeBillingAnnualType = z.infer<
  typeof franchiseeBillingAnnualTypeSchema
>;
export type FranchiseeBillingAnnualQuery = z.infer<
  typeof franchiseeBillingAnnualQuerySchema
>;
export type FranchiseeBillingAnnualRow = z.infer<
  typeof franchiseeBillingAnnualRowSchema
>;
export type FranchiseeBillingAnnualPayload = z.infer<
  typeof franchiseeBillingAnnualPayloadSchema
>;
