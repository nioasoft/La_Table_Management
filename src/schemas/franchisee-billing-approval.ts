import { z } from "zod";

const periodFields = {
  periodYear: z.number().int().min(2000).max(2100),
  periodMonth: z.number().int().min(1).max(12),
} as const;

const recipientSchema = z.strictObject({
  franchiseeId: z.string().trim().min(1).max(100),
  emails: z.array(z.string().trim().email().max(254)).max(20),
});

const failedEmailSchema = z.strictObject({
  billingId: z.string().trim().min(1).max(100),
  franchiseeId: z.string().trim().min(1).max(100),
  email: z.string().trim().email().max(254),
  error: z.string(),
});

const approveSchema = z.strictObject({
  action: z.literal("approve"),
  ...periodFields,
  recipients: z.array(recipientSchema).max(100),
});

const retryFailedSchema = z.strictObject({
  action: z.literal("retry_failed"),
  ...periodFields,
  failures: z.array(failedEmailSchema.omit({ error: true })).min(1).max(100),
});

export const franchiseeBillingApprovalSchema = z.discriminatedUnion("action", [
  approveSchema,
  retryFailedSchema,
]);

const approvalResultDataSchema = z.strictObject({
  approvalCommitted: z.boolean(),
  alreadyApproved: z.boolean(),
  billingsApproved: z.number().int().nonnegative(),
  ledgerEntriesCreated: z.number().int().nonnegative(),
  emailsSent: z.number().int().nonnegative(),
  emailFailures: z.array(failedEmailSchema),
});

export const franchiseeBillingApprovalResponseSchema = z.object({
  success: z.boolean(),
  data: approvalResultDataSchema.optional(),
  error: z.string().optional(),
  requestId: z.string(),
});

export type FranchiseeBillingApprovalInput = z.infer<
  typeof franchiseeBillingApprovalSchema
>;
export type FranchiseeBillingApproveInput = Extract<
  FranchiseeBillingApprovalInput,
  { readonly action: "approve" }
>;
export type FranchiseeBillingRetryInput = Extract<
  FranchiseeBillingApprovalInput,
  { readonly action: "retry_failed" }
>;
export type FranchiseeBillingEmailFailure = z.infer<typeof failedEmailSchema>;
export type FranchiseeBillingApprovalResponse = z.infer<
  typeof franchiseeBillingApprovalResponseSchema
>;
