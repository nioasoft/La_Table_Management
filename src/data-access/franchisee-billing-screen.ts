import type {
  FranchiseeBillingStatus,
  FranchiseeOwner,
} from "@/db/schema";
import {
  franchiseeBillingSourceReviewSchema,
  type FranchiseeBillingPeriod,
  type FranchiseeBillingSourceReview,
} from "@/schemas/franchisee-billing-screen";
import { buildReopenedBilling } from "@/lib/franchisee-billing-reopen";
import type { RoyaltyTier, RoyaltyTierBasis } from "@/lib/royalty";

export interface BillingScreenRow {
  readonly id: string;
  readonly franchiseeId: string;
  readonly franchiseeName: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly grossBase: string;
  readonly netBase: string;
  readonly tierRate: string;
  readonly discountRatePoints: string;
  readonly discountValue: string;
  readonly royalty: string;
  readonly marketing: string;
  readonly subtotal: string;
  readonly total: string;
  readonly noRevenueReason: string | null;
  readonly deferralBalance: string;
  readonly sourceFileId: string | null;
  readonly sourceFileName: string | null;
  readonly isStaleSource: boolean;
  readonly isApprovalBlocked: boolean;
  readonly status: FranchiseeBillingStatus;
  readonly owners?: readonly FranchiseeOwner[] | null;
}

export interface BillingSourceReviewRecord {
  readonly id: string;
  readonly fileName: string;
  readonly metadata: unknown;
}

export interface BillingSourceReviewRow extends BillingSourceReviewRecord {
  readonly brandId: string;
}

export type BillingSourceReviewsByBrand = ReadonlyMap<
  string,
  BillingSourceReviewRecord
>;

export interface BillingDiscountContext {
  readonly id: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly tierRate: string;
  readonly netBase: string;
  readonly royaltyFull: string;
  readonly marketing: string;
  readonly status: FranchiseeBillingStatus;
}

export interface BillingNoRevenueContext {
  readonly id: string;
  readonly status: FranchiseeBillingStatus;
  readonly royalty: string;
  readonly marketing: string;
  readonly total: string;
}

export interface ReopenableBilling extends BillingDiscountContext {
  readonly franchiseeId: string;
  readonly receipts: string;
  readonly tips: string;
  readonly includeTips: boolean;
  readonly grossBase: string;
  readonly discountRatePoints: string;
  readonly effectiveRate: string;
  readonly royalty: string;
  readonly discountValue: string;
  readonly subtotal: string;
  readonly total: string;
  readonly tiersSnapshot: readonly RoyaltyTier[] | null;
  readonly tierBasisSnapshot: RoyaltyTierBasis | null;
  readonly marketingRateSnapshot: string | null;
  readonly vatRateSnapshot: string | null;
  readonly royaltyExportedAt: Date | null;
  readonly royaltyExportBatchId: string | null;
  readonly marketingExportedAt: Date | null;
  readonly marketingExportBatchId: string | null;
}

export interface DifferenceResolutionContext {
  readonly source: BillingSourceReviewRecord;
  readonly billing: ReopenableBilling;
}

export interface DiscountAmounts {
  readonly discountRatePoints: number;
  readonly effectiveRate: number;
  readonly royalty: number;
  readonly discountValue: number;
  readonly subtotal: number;
  readonly total: number;
}

export interface PersistDiscountInput {
  readonly billingId: string;
  readonly discountRatePoints: string;
  readonly effectiveRate: string;
  readonly royalty: string;
  readonly discountValue: string;
  readonly subtotal: string;
  readonly total: string;
}

export interface PersistNoRevenueReasonInput {
  readonly billingId: string;
  readonly noRevenueReason: string | null;
}

export interface ReopenedBillingValues {
  readonly billingId: string;
  readonly franchiseeId: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly receipts: string;
  readonly tips: string;
  readonly includeTips: boolean;
  readonly grossBase: string;
  readonly netBase: string;
  readonly tierRate: string;
  readonly discountRatePoints: string;
  readonly effectiveRate: string;
  readonly royaltyFull: string;
  readonly royalty: string;
  readonly discountValue: string;
  readonly marketing: string;
  readonly subtotal: string;
  readonly total: string;
  readonly sourceFileId: string;
}

export interface PersistDifferenceResolutionInput {
  readonly sourceFileId: string;
  readonly franchiseeId: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly expectedMetadata: unknown;
  readonly updatedMetadata: FranchiseeBillingSourceReview;
  readonly reopenedBilling?: ReopenedBillingValues;
}

export interface BillingPeriodSnapshot {
  readonly rows: readonly BillingScreenRow[];
  readonly sourcesByBrand: BillingSourceReviewsByBrand;
}

export type PersistDifferenceResolutionResult =
  | "success"
  | "conflict"
  | "exported";

export interface BillingScreenOperations {
  readonly readPeriodSnapshot: (
    period: FranchiseeBillingPeriod,
  ) => Promise<BillingPeriodSnapshot>;
  readonly readDiscountContext: (
    billingId: string,
  ) => Promise<BillingDiscountContext | null>;
  readonly readVatRate: (
    period: FranchiseeBillingPeriod,
  ) => Promise<number | null>;
  readonly persistDiscount: (input: PersistDiscountInput) => Promise<boolean>;
  readonly readNoRevenueContext: (
    billingId: string,
  ) => Promise<BillingNoRevenueContext | null>;
  readonly persistNoRevenueReason: (
    input: PersistNoRevenueReasonInput,
  ) => Promise<boolean>;
  readonly readDifferenceContext: (
    sourceFileId: string,
    franchiseeId: string,
  ) => Promise<DifferenceResolutionContext | null>;
  readonly persistDifferenceResolution: (
    input: PersistDifferenceResolutionInput,
  ) => Promise<PersistDifferenceResolutionResult>;
}

export interface BillingScreenAnomaly {
  readonly code: string;
  readonly rowIndex: number;
  readonly branchName: string;
  readonly franchiseeId?: string;
  readonly franchiseeName?: string;
  readonly message: string;
}

export interface BillingScreenApprovedDifference {
  readonly franchiseeId: string;
  readonly franchiseeName: string;
  readonly sourceFileId: string;
  readonly differences: readonly {
    readonly field: string;
    readonly approvedValue: unknown;
    readonly uploadedValue: unknown;
  }[];
}

export interface FranchiseeBillingScreenData {
  readonly period: FranchiseeBillingPeriod;
  readonly sourceFiles: readonly {
    readonly brandId: string;
    readonly id: string;
    readonly fileName: string;
  }[];
  readonly rows: readonly BillingScreenRow[];
  readonly anomalies: readonly BillingScreenAnomaly[];
  readonly approvedDifferences: readonly BillingScreenApprovedDifference[];
  readonly warnings: readonly string[];
  readonly hasBlockingIssues: boolean;
}

type MutationFailureCode =
  | "not_found"
  | "approved"
  | "discount_exceeds_tier"
  | "vat_missing"
  | "nonzero"
  | "conflict"
  | "invalid_review"
  | "exported";

type MutationResult<T> =
  | { readonly success: true; readonly data: T }
  | {
      readonly success: false;
      readonly code: MutationFailureCode;
      readonly error: string;
    };

async function defaultOperations(): Promise<BillingScreenOperations> {
  const runtime = await import("@/data-access/franchisee-billing-screen-runtime");
  return runtime.createBillingScreenOperations();
}

function parseReview(metadata: unknown): FranchiseeBillingSourceReview {
  return franchiseeBillingSourceReviewSchema.parse(metadata);
}

type ReviewProjection = Pick<
  FranchiseeBillingScreenData,
  "anomalies" | "approvedDifferences" | "warnings"
>;

function projectSourceReviews(
  rows: readonly BillingScreenRow[],
  sourcesByBrand: BillingSourceReviewsByBrand,
): ReviewProjection {
  const reviews = [...sourcesByBrand.values()].map((source) => ({
    source,
    review: parseReview(source.metadata),
  }));
  const names = new Map(
    rows.map((row) => [row.franchiseeId, row.franchiseeName]),
  );
  return {
    anomalies: reviews.flatMap(({ review }) =>
      review.anomalies.map((finding) => ({
        ...finding,
        ...(finding.franchiseeId && names.has(finding.franchiseeId)
          ? { franchiseeName: names.get(finding.franchiseeId) }
          : {}),
      }))),
    approvedDifferences: reviews.flatMap(({ source, review }) =>
      review.approvedDifferences.map((difference) => ({
        franchiseeId: difference.franchiseeId,
        franchiseeName:
          names.get(difference.franchiseeId) ?? "זכיין לא מזוהה",
        sourceFileId: source.id,
        differences: difference.differences,
      }))),
    warnings: reviews.flatMap(({ review }) => review.warnings),
  };
}

export function calculateDiscountAmounts(
  billing: BillingDiscountContext,
  discountRatePoints: number,
  vat: number,
): DiscountAmounts {
  const tierRate = Number(billing.tierRate);
  if (discountRatePoints > tierRate) {
    throw new Error("הדחייה לא יכולה להיות גבוהה מתעריף המדרגה");
  }
  const effectiveRate = Math.max(0, tierRate - discountRatePoints);
  const royalty = Number(billing.netBase) * effectiveRate / 100;
  const discountValue = Number(billing.royaltyFull) - royalty;
  const subtotal = royalty + Number(billing.marketing);
  return {
    discountRatePoints,
    effectiveRate,
    royalty,
    discountValue,
    subtotal,
    total: subtotal * (1 + vat),
  };
}

export async function loadFranchiseeBillingScreen(
  period: FranchiseeBillingPeriod,
  operations?: BillingScreenOperations,
): Promise<FranchiseeBillingScreenData> {
  const activeOperations = operations ?? await defaultOperations();
  const { rows, sourcesByBrand } =
    await activeOperations.readPeriodSnapshot(period);
  const sourceFiles = [...sourcesByBrand].map(([brandId, source]) => ({
    brandId,
    id: source.id,
    fileName: source.fileName,
  }));
  if (sourcesByBrand.size === 0) {
    return {
      period,
      sourceFiles,
      rows,
      anomalies: [],
      approvedDifferences: [],
      warnings: [],
      hasBlockingIssues: rows.some((row) => row.isApprovalBlocked),
    };
  }
  const reviewProjection = projectSourceReviews(rows, sourcesByBrand);
  return {
    period,
    sourceFiles,
    rows,
    ...reviewProjection,
    hasBlockingIssues:
      reviewProjection.anomalies.length > 0 ||
      reviewProjection.approvedDifferences.length > 0 ||
      rows.some((row) => row.isApprovalBlocked),
  };
}

function failure(
  code: MutationFailureCode,
  error: string,
): MutationResult<never> {
  return { success: false, code, error };
}

export async function updateBillingDiscount(
  billingId: string,
  discountRatePoints: number,
  operations?: BillingScreenOperations,
): Promise<MutationResult<DiscountAmounts>> {
  const activeOperations = operations ?? await defaultOperations();
  const billing = await activeOperations.readDiscountContext(billingId);
  if (!billing) return failure("not_found", "שורת החיוב לא נמצאה");
  if (billing.status === "approved") {
    return failure("approved", "שורה מאושרת אינה ניתנת לעריכה");
  }
  const vat = await activeOperations.readVatRate({
    year: billing.periodYear,
    month: billing.periodMonth,
  });
  if (vat === null) {
    return failure("vat_missing", "לא נמצא שיעור מע״מ לחודש החיוב");
  }

  let amounts: DiscountAmounts;
  try {
    amounts = calculateDiscountAmounts(billing, discountRatePoints, vat);
  } catch {
    return failure(
      "discount_exceeds_tier",
      "הדחייה לא יכולה להיות גבוהה מתעריף המדרגה",
    );
  }
  const persisted = await activeOperations.persistDiscount({
    billingId,
    discountRatePoints: String(amounts.discountRatePoints),
    effectiveRate: String(amounts.effectiveRate),
    royalty: String(amounts.royalty),
    discountValue: String(amounts.discountValue),
    subtotal: String(amounts.subtotal),
    total: String(amounts.total),
  });
  return persisted
    ? { success: true, data: amounts }
    : failure("conflict", "השורה השתנתה ולא נשמרה. רענני את העמוד ונסי שוב");
}

function isStoredZero(value: string): boolean {
  const amount = Number(value);
  return Number.isFinite(amount) && amount === 0;
}

export async function updateBillingNoRevenueReason(
  billingId: string,
  noRevenueReason: string | null,
  operations?: BillingScreenOperations,
): Promise<MutationResult<{ readonly noRevenueReason: string | null }>> {
  const activeOperations = operations ?? await defaultOperations();
  const billing = await activeOperations.readNoRevenueContext(billingId);
  if (!billing) return failure("not_found", "שורת החיוב לא נמצאה");
  if (billing.status === "approved") {
    return failure("approved", "שורה מאושרת אינה ניתנת לעריכה");
  }
  const reason = noRevenueReason?.trim() || null;
  const allAmountsZero = [
    billing.royalty,
    billing.marketing,
    billing.total,
  ].every(isStoredZero);
  if (reason && !allAmountsZero) {
    return failure(
      "nonzero",
      "ניתן לסמן ללא מחזור רק כאשר התמלוגים, השיווק והסכום הכולל הם אפס",
    );
  }
  const persisted = await activeOperations.persistNoRevenueReason({
    billingId,
    noRevenueReason: reason,
  });
  return persisted
    ? { success: true, data: { noRevenueReason: reason } }
    : failure("conflict", "השורה השתנתה ולא נשמרה. רענני את העמוד ונסי שוב");
}

export interface ResolveApprovedDifferenceInput {
  readonly sourceFileId: string;
  readonly franchiseeId: string;
  readonly resolution: "reopen" | "keep";
}

export async function resolveApprovedBillingDifference(
  input: ResolveApprovedDifferenceInput,
  operations?: BillingScreenOperations,
): Promise<MutationResult<{ readonly resolution: "reopen" | "keep" }>> {
  const activeOperations = operations ?? await defaultOperations();
  const context = await activeOperations.readDifferenceContext(
    input.sourceFileId,
    input.franchiseeId,
  );
  if (!context) return failure("not_found", "פער החיוב לא נמצא");
  const review = parseReview(context.source.metadata);
  const difference = review.approvedDifferences.find(
    (entry) => entry.franchiseeId === input.franchiseeId,
  );
  if (!difference) return failure("not_found", "פער החיוב כבר טופל");
  const exported =
    context.billing.royaltyExportedAt !== null ||
    context.billing.royaltyExportBatchId !== null ||
    context.billing.marketingExportedAt !== null ||
    context.billing.marketingExportBatchId !== null;
  if (input.resolution === "reopen" && exported) {
    return failure(
      "exported",
      "לא ניתן לפתוח מחדש חיוב שכבר יוצא לחשבשבת",
    );
  }
  const reopenedBilling = input.resolution === "reopen"
    ? buildReopenedBilling(
        context,
        input.sourceFileId,
        difference.differences,
      )
    : undefined;
  if (input.resolution === "reopen" && !reopenedBilling) {
    return failure("invalid_review", "נתוני הקובץ המעודכן אינם תקינים");
  }
  const updatedMetadata = {
    ...review,
    approvedDifferences: review.approvedDifferences.filter(
      (entry) => entry.franchiseeId !== input.franchiseeId,
    ),
  };
  const persisted = await activeOperations.persistDifferenceResolution({
    sourceFileId: input.sourceFileId,
    franchiseeId: input.franchiseeId,
    periodYear: context.billing.periodYear,
    periodMonth: context.billing.periodMonth,
    expectedMetadata: context.source.metadata,
    updatedMetadata,
    ...(reopenedBilling ? { reopenedBilling } : {}),
  });
  if (persisted === "exported") {
    return failure(
      "exported",
      "לא ניתן לפתוח מחדש חיוב שכבר יוצא לחשבשבת",
    );
  }
  return persisted === "success"
    ? { success: true, data: { resolution: input.resolution } }
    : failure("conflict", "הפער השתנה ולא נשמר. רענני את העמוד ונסי שוב");
}
