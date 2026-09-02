import { z } from "zod";

import { franchiseeBillingPeriodSchema } from "@/schemas/franchisee-billing-screen";

export const franchiseeBillingReportTypeSchema = z.enum(
  ["summary", "royalties", "turnover", "collection", "discounts"],
  { error: "סוג הדוח אינו תקין" },
);

export const franchiseeBillingReportQuerySchema = z.strictObject({
  reportType: franchiseeBillingReportTypeSchema,
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
  month: z.coerce
    .number()
    .int("חודש הדוח אינו תקין")
    .min(1, "חודש הדוח אינו תקין")
    .max(12, "חודש הדוח אינו תקין"),
});

const reportIdentitySchema = z.object({
  franchiseeId: z.string(),
  franchiseeName: z.string(),
  brandName: z.string(),
});

export const summaryReportRowSchema = reportIdentitySchema.extend({
  grossBase: z.string(),
  netBase: z.string(),
  effectiveRate: z.string(),
  royalty: z.string(),
  marketing: z.string(),
  total: z.string(),
  status: z.enum(["draft", "approved"]),
});

export const royaltyReportRowSchema = reportIdentitySchema.extend({
  royalty: z.string(),
  tierRate: z.string(),
  effectiveRate: z.string(),
  discountValue: z.string(),
  status: z.enum(["draft", "approved"]),
});

export const turnoverReportRowSchema = reportIdentitySchema.extend({
  grossBase: z.string(),
  netBase: z.string(),
  status: z.enum(["draft", "approved"]),
});

export const collectionReportRowSchema = reportIdentitySchema.extend({
  royaltyCollected: z.string(),
  marketingCollected: z.string(),
});

export const discountReportRowSchema = reportIdentitySchema.extend({
  discountValue: z.string(),
});

const periodShape = {
  period: franchiseeBillingPeriodSchema,
};

const summaryPayloadSchema = z.object({
  reportType: z.literal("summary"),
  ...periodShape,
  /** The month's VAT rate, for the totals-with-VAT line. Null when none is configured. */
  vatRate: z.string().nullable(),
  rows: z.array(summaryReportRowSchema),
});

const royaltyPayloadSchema = z.object({
  reportType: z.literal("royalties"),
  ...periodShape,
  rows: z.array(royaltyReportRowSchema),
});

const turnoverPayloadSchema = z.object({
  reportType: z.literal("turnover"),
  ...periodShape,
  rows: z.array(turnoverReportRowSchema),
});

const collectionPayloadSchema = z.object({
  reportType: z.literal("collection"),
  ...periodShape,
  rows: z.array(collectionReportRowSchema),
});

const discountPayloadSchema = z.object({
  reportType: z.literal("discounts"),
  ...periodShape,
  rows: z.array(discountReportRowSchema),
});

export const franchiseeBillingReportPayloadSchema = z.discriminatedUnion(
  "reportType",
  [
    summaryPayloadSchema,
    royaltyPayloadSchema,
    turnoverPayloadSchema,
    collectionPayloadSchema,
    discountPayloadSchema,
  ],
);

export const franchiseeBillingReportResponseSchema = z.object({
  success: z.literal(true),
  data: franchiseeBillingReportPayloadSchema,
  requestId: z.string(),
});

export type FranchiseeBillingReportType = z.infer<
  typeof franchiseeBillingReportTypeSchema
>;
export type FranchiseeBillingReportQuery = z.infer<
  typeof franchiseeBillingReportQuerySchema
>;
export type SummaryReportRow = z.infer<typeof summaryReportRowSchema>;
export type RoyaltyReportRow = z.infer<typeof royaltyReportRowSchema>;
export type TurnoverReportRow = z.infer<typeof turnoverReportRowSchema>;
export type CollectionReportRow = z.infer<typeof collectionReportRowSchema>;
export type DiscountReportRow = z.infer<typeof discountReportRowSchema>;
export type FranchiseeBillingReportPayload = z.infer<
  typeof franchiseeBillingReportPayloadSchema
>;
