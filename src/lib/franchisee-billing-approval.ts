import {
  calculateRoyalty,
  type RoyaltyTier,
  type RoyaltyTierBasis,
} from "@/lib/royalty";
import type {
  FranchiseeBillingStatus,
  FranchiseeOwner,
} from "@/db/schema";
import type { FranchiseeBillingEmailProps } from "@/emails/franchisee-billing";
import type { FranchiseeBillingRetryInput } from "@/schemas/franchisee-billing-approval";

export interface ApprovalPeriod {
  readonly year: number;
  readonly month: number;
}

export interface ApprovalBillingRow extends ApprovalCalculationRow {
  readonly id: string;
  readonly franchiseeId: string;
  readonly franchiseeName: string;
  readonly brandId: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly sourceFileId: string | null;
  readonly status: FranchiseeBillingStatus;
  readonly royaltyTiers: RoyaltyTier[] | null;
  readonly royaltyTierBasis: RoyaltyTierBasis;
  readonly royaltyTiersConfirmed: boolean;
  readonly marketingFeeRate: string | null;
  readonly hashavshevetAccountKey: string | null;
  readonly owners: FranchiseeOwner[] | null;
  readonly tiersSnapshot: RoyaltyTier[] | null;
  readonly tierBasisSnapshot: RoyaltyTierBasis | null;
  readonly marketingRateSnapshot: string | null;
  readonly vatRateSnapshot: string | null;
  readonly accountKeySnapshot: string | null;
}

export interface ApprovalSourceReview {
  readonly id: string;
  readonly fileName: string;
  readonly metadata: unknown;
}

export interface PersistBillingApprovalInput {
  readonly billingId: string;
  readonly tiersSnapshot: RoyaltyTier[];
  readonly tierBasisSnapshot: RoyaltyTierBasis;
  readonly marketingRateSnapshot: string;
  readonly vatRateSnapshot: string;
  readonly accountKeySnapshot: string;
  readonly approvedAt: Date;
  readonly approvedBy: string;
}

export interface LedgerEntryInput {
  readonly billingId: string;
  readonly franchiseeId: string;
  readonly amount: string;
  readonly createdBy: string;
  readonly note: string;
}

export interface ApprovalEmailLog {
  readonly entityId: string | null;
  readonly toEmail: string;
  readonly status: "pending" | "sent" | "delivered" | "failed" | "bounced";
  readonly metadata: unknown;
}

export interface ApprovalStore {
  loadRowsForUpdate(
    period: ApprovalPeriod,
  ): Promise<readonly ApprovalBillingRow[]>;
  loadLatestSources(
    period: ApprovalPeriod,
  ): Promise<ReadonlyMap<string, ApprovalSourceReview>>;
  loadVatRate(period: ApprovalPeriod): Promise<string | null>;
  persistApproval(input: PersistBillingApprovalInput): Promise<boolean>;
  insertLedger(entries: readonly LedgerEntryInput[]): Promise<void>;
}

export interface ApprovalEmailMessage {
  readonly billingId: string;
  readonly franchiseeId: string;
  readonly to: string;
  readonly props: FranchiseeBillingEmailProps;
}

export interface RetryEmailContext {
  readonly rows: readonly ApprovalBillingRow[];
  readonly logs: readonly ApprovalEmailLog[];
}

export interface FranchiseeBillingApprovalOperations {
  withTransaction<T>(work: (store: ApprovalStore) => Promise<T>): Promise<T>;
  loadRetryContext(
    input: FranchiseeBillingRetryInput,
  ): Promise<RetryEmailContext>;
  sendEmail(message: ApprovalEmailMessage): Promise<{
    readonly success: boolean;
    readonly error?: string;
  }>;
}

const MONEY_SCALE = 6;
const RATE_SCALE = 2;

const financialFields = [
  "grossBase",
  "netBase",
  "tierRate",
  "effectiveRate",
  "royaltyFull",
  "royalty",
  "discountValue",
  "marketing",
  "subtotal",
  "total",
] as const;

export type ApprovalFinancialField = (typeof financialFields)[number];

export interface ApprovalCalculationRow {
  readonly receipts: string;
  readonly tips: string;
  readonly includeTips: boolean;
  readonly discountRatePoints: string;
  readonly grossBase: string;
  readonly netBase: string;
  readonly tierRate: string;
  readonly effectiveRate: string;
  readonly royaltyFull: string;
  readonly royalty: string;
  readonly discountValue: string;
  readonly marketing: string;
  readonly subtotal: string;
  readonly total: string;
}

export interface ApprovalCalculationConfig {
  readonly tiers: readonly RoyaltyTier[];
  readonly tierBasis: RoyaltyTierBasis;
  readonly marketingRate: number;
  readonly vat: number;
}

export type CanonicalApprovalCalculation = Readonly<
  Record<ApprovalFinancialField, string>
>;

export interface ApprovalCalculationMismatch {
  readonly field: ApprovalFinancialField;
  readonly stored: string;
  readonly calculated: string;
  readonly difference: string;
}

export type ApprovalCalculationValidation =
  | {
      readonly success: true;
      readonly calculation: CanonicalApprovalCalculation;
    }
  | {
      readonly success: false;
      readonly mismatch: ApprovalCalculationMismatch;
    };

const fieldScale: Readonly<Record<ApprovalFinancialField, number>> = {
  grossBase: MONEY_SCALE,
  netBase: MONEY_SCALE,
  tierRate: RATE_SCALE,
  effectiveRate: RATE_SCALE,
  royaltyFull: MONEY_SCALE,
  royalty: MONEY_SCALE,
  discountValue: MONEY_SCALE,
  marketing: MONEY_SCALE,
  subtotal: MONEY_SCALE,
  total: MONEY_SCALE,
};

/**
 * Serializes a calculation exactly as PostgreSQL numeric(p, s) stores it.
 * This is storage canonicalization, not a business-money rounding rule.
 */
export function canonicalStoredDecimal(value: number, scale: number): string {
  if (!Number.isFinite(value)) {
    throw new Error("Billing calculation produced a non-finite value");
  }
  return value.toFixed(scale);
}

export function calculateCanonicalApproval(
  row: ApprovalCalculationRow,
  config: ApprovalCalculationConfig,
): CanonicalApprovalCalculation {
  const calculated = calculateRoyalty({
    receipts: Number(row.receipts),
    tips: Number(row.tips),
    includeTips: row.includeTips,
    tiers: config.tiers,
    tierBasis: config.tierBasis,
    marketingRate: config.marketingRate,
    discountRatePoints: Number(row.discountRatePoints),
    vat: config.vat,
  });
  return {
    grossBase: canonicalStoredDecimal(calculated.grossBase, MONEY_SCALE),
    netBase: canonicalStoredDecimal(calculated.netBase, MONEY_SCALE),
    tierRate: canonicalStoredDecimal(calculated.tierRate, RATE_SCALE),
    effectiveRate: canonicalStoredDecimal(calculated.effectiveRate, RATE_SCALE),
    royaltyFull: canonicalStoredDecimal(calculated.royaltyFull, MONEY_SCALE),
    royalty: canonicalStoredDecimal(calculated.royalty, MONEY_SCALE),
    discountValue: canonicalStoredDecimal(
      calculated.discountValue,
      MONEY_SCALE,
    ),
    marketing: canonicalStoredDecimal(calculated.marketing, MONEY_SCALE),
    subtotal: canonicalStoredDecimal(calculated.subtotal, MONEY_SCALE),
    total: canonicalStoredDecimal(calculated.total, MONEY_SCALE),
  };
}

function normalizedStoredValue(
  row: ApprovalCalculationRow,
  field: ApprovalFinancialField,
): string {
  return canonicalStoredDecimal(Number(row[field]), fieldScale[field]);
}

export function validateApprovalCalculation(
  row: ApprovalCalculationRow,
  config: ApprovalCalculationConfig,
): ApprovalCalculationValidation {
  const calculation = calculateCanonicalApproval(row, config);
  for (const field of financialFields) {
    const stored = normalizedStoredValue(row, field);
    if (stored === calculation[field]) continue;
    return {
      success: false,
      mismatch: {
        field,
        stored,
        calculated: calculation[field],
        difference: canonicalStoredDecimal(
          Number(stored) - Number(calculation[field]),
          fieldScale[field],
        ),
      },
    };
  }
  return { success: true, calculation };
}
