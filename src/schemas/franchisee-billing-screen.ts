import { z } from "zod";

const billingYearSchema = z.coerce
  .number()
  .int("שנת החיוב אינה תקינה")
  .min(2020, "שנת החיוב אינה תקינה")
  .max(2100, "שנת החיוב אינה תקינה");

const billingMonthSchema = z.coerce
  .number()
  .int("חודש החיוב אינו תקין")
  .min(1, "חודש החיוב אינו תקין")
  .max(12, "חודש החיוב אינו תקין");

export const franchiseeBillingPeriodSchema = z.strictObject({
  year: billingYearSchema,
  month: billingMonthSchema,
});

const discountRatePointsSchema = z
  .number()
  .finite("הדחייה חייבת להיות מספר")
  .min(0, "הדחייה חייבת להיות אפס או יותר")
  .max(100, "הדחייה חייבת להיות בין 0 ל־100")
  .multipleOf(0.01, "הדחייה יכולה להכיל עד שתי ספרות אחרי הנקודה");

const updateDiscountSchema = z.strictObject({
  action: z.literal("update_discount"),
  billingId: z.string().trim().min(1, "מזהה שורת החיוב חסר"),
  discountRatePoints: discountRatePointsSchema,
});

const resolveDifferenceSchema = z.strictObject({
  action: z.literal("resolve_difference"),
  sourceFileId: z.string().trim().min(1, "מזהה קובץ המקור חסר"),
  franchiseeId: z.string().trim().min(1, "מזהה הזכיין חסר"),
  resolution: z.enum(["reopen", "keep"], {
    error: "בחירת הטיפול בפער אינה תקינה",
  }),
});

export const franchiseeBillingMutationSchema = z.discriminatedUnion("action", [
  updateDiscountSchema,
  resolveDifferenceSchema,
]);

const storedAnomalySchema = z.object({
  code: z.string(),
  rowIndex: z.number().int(),
  branchName: z.string(),
  franchiseeId: z.string().optional(),
  message: z.string(),
});

const storedFieldDifferenceSchema = z.object({
  field: z.string(),
  approvedValue: z.unknown(),
  uploadedValue: z.unknown(),
});

const storedApprovedDifferenceSchema = z.object({
  franchiseeId: z.string(),
  status: z.literal("approved"),
  differences: z.array(storedFieldDifferenceSchema),
});

export const franchiseeBillingSourceReviewSchema = z
  .object({
    documentType: z.literal("franchisee_royalty_revenue"),
    anomalies: z.array(storedAnomalySchema).default([]),
    approvedDifferences: z.array(storedApprovedDifferenceSchema).default([]),
    warnings: z.array(z.string()).default([]),
    draftsWritten: z.number().int().nonnegative().default(0),
  })
  .passthrough();

const billingScreenRowSchema = z.object({
  id: z.string(),
  franchiseeId: z.string(),
  franchiseeName: z.string(),
  periodYear: z.number().int(),
  periodMonth: z.number().int().min(1).max(12),
  grossBase: z.string(),
  netBase: z.string(),
  tierRate: z.string(),
  discountRatePoints: z.string(),
  discountValue: z.string(),
  royalty: z.string(),
  marketing: z.string(),
  subtotal: z.string(),
  total: z.string(),
  deferralBalance: z.string(),
  sourceFileId: z.string().nullable(),
  sourceFileName: z.string().nullable(),
  isStaleSource: z.boolean(),
  isApprovalBlocked: z.boolean(),
  status: z.enum(["draft", "approved"]),
  owners: z.array(z.object({
    name: z.string(),
    email: z.string(),
  }).passthrough()).nullable().optional(),
});

export const franchiseeBillingScreenDataSchema = z.object({
  period: franchiseeBillingPeriodSchema,
  sourceFile: z.object({
    id: z.string(),
    fileName: z.string(),
  }).nullable(),
  rows: z.array(billingScreenRowSchema),
  anomalies: z.array(storedAnomalySchema.extend({
    franchiseeName: z.string().optional(),
  })),
  approvedDifferences: z.array(z.object({
    franchiseeId: z.string(),
    franchiseeName: z.string(),
    sourceFileId: z.string(),
    differences: z.array(storedFieldDifferenceSchema),
  })),
  warnings: z.array(z.string()),
  hasBlockingIssues: z.boolean(),
});

export const franchiseeBillingScreenResponseSchema = z.object({
  success: z.literal(true),
  data: franchiseeBillingScreenDataSchema,
  requestId: z.string(),
});

export const franchiseeBillingUploadResponseSchema = z.object({
  success: z.literal(true),
  data: z.object({
    period: franchiseeBillingPeriodSchema,
    sourceFileId: z.string(),
    draftsWritten: z.number().int().nonnegative(),
    hasBlockingIssues: z.boolean(),
  }).passthrough(),
  requestId: z.string(),
});

export const franchiseeBillingMutationResponseSchema = z.object({
  success: z.literal(true),
  data: z.unknown(),
  requestId: z.string(),
});

export type FranchiseeBillingPeriod = z.infer<
  typeof franchiseeBillingPeriodSchema
>;
export type FranchiseeBillingMutation = z.infer<
  typeof franchiseeBillingMutationSchema
>;
export type FranchiseeBillingSourceReview = z.infer<
  typeof franchiseeBillingSourceReviewSchema
>;
export type FranchiseeBillingScreenPayload = z.infer<
  typeof franchiseeBillingScreenDataSchema
>;
