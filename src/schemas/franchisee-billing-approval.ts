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

/**
 * A hand-triggered notice to one franchisee whose approved row carries a
 * discount. Never sent automatically, never to the whole month.
 */
export const franchiseeBillingDiscountEmailSchema = z.strictObject({
  billingId: z.string().trim().min(1).max(100),
  emails: z.array(z.string().trim().email().max(254)).min(1).max(20),
});

export type FranchiseeBillingApprovalInput = z.infer<
  typeof franchiseeBillingApprovalSchema
>;
export type FranchiseeBillingApproveInput = FranchiseeBillingApprovalInput;
export type FranchiseeBillingDiscountEmailInput = z.infer<
  typeof franchiseeBillingDiscountEmailSchema
>;
export type FranchiseeBillingApprovalResponse = z.infer<
  typeof franchiseeBillingApprovalResponseSchema
>;
