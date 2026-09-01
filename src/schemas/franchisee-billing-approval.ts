import { z } from "zod";

const periodFields = {
  periodYear: z.number().int().min(2000).max(2100),
  periodMonth: z.number().int().min(1).max(12),
} as const;

/** Approval writes billing rows and the deferral ledger. Nothing is sent. */
export const franchiseeBillingApprovalSchema = z.strictObject({
  action: z.literal("approve"),
  ...periodFields,
});

const approvalResultDataSchema = z.strictObject({
  approvalCommitted: z.boolean(),
  alreadyApproved: z.boolean(),
  billingsApproved: z.number().int().nonnegative(),
  ledgerEntriesCreated: z.number().int().nonnegative(),
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
export type FranchiseeBillingApproveInput = FranchiseeBillingApprovalInput;
export type FranchiseeBillingApprovalResponse = z.infer<
  typeof franchiseeBillingApprovalResponseSchema
>;
