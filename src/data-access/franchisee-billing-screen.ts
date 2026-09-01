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
import {
  calculateRoyalty,
  type RoyaltyTier,
  type RoyaltyTierBasis,
} from "@/lib/royalty";

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
  readonly createdAt: Date;
}

/** An upload with no billing row: its brand is inferred from its anomalies. */
export interface BillingUnlinkedSourceRow extends BillingSourceReviewRecord {
  readonly brandId: string | null;
  readonly createdAt: Date;
}

export type BillingSourceReviewsByBrand = ReadonlyMap<
  string,
  BillingSourceReviewRecord
>;

export interface BillingDiscountContext {
  readonly id: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly receipts: string;
  readonly tips: string;
  readonly includeTips: boolean;
  readonly tiers: readonly RoyaltyTier[];
  readonly tierBasis: RoyaltyTierBasis;
  readonly marketingRate: string;
  readonly status: FranchiseeBillingStatus;
}

export interface BillingNoRevenueContext {
  readonly id: string;
  readonly status: FranchiseeBillingStatus;
  readonly royalty: string;
  readonly marketing: string;
  readonly total: string;
}

export interface ReopenableBilling {
  readonly id: string;
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
  readonly status: FranchiseeBillingStatus;
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
  /**
   * Uploads that produced no billing row at all — every row was blocked by an
   * anomaly. They have no brand to be grouped under, and without them the
   * screen would report the month as never uploaded.
   */
  readonly unlinkedSources: readonly BillingSourceReviewRecord[];
}

export type PersistDifferenceResolutionResult =
  | "success"
  | "conflict"
  | "exported";

export type DiscardSourceFileResult = "success" | "not_found" | "approved";

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
  readonly discardSourceFile: (
    sourceFileId: string,
  ) => Promise<DiscardSourceFileResult>;
  readonly readBillableFranchisees: () => Promise<
    readonly BillingScreenFranchisee[]
  >;
}

export interface BillingScreenAnomaly {
  readonly code: string;
  readonly rowIndex: number;
  readonly branchName: string;
  readonly franchiseeId?: string;
  readonly franchiseeName?: string;
  readonly message: string;
  readonly receipts?: number | null;
  readonly tips?: number | null;
  /** Which upload the finding came from — the row cannot be settled without it. */
  readonly sourceFileId: string;
  readonly sourceFileName: string;
}

/** The franchisees a blocked row may be assigned to. */
export interface BillingScreenFranchisee {
  readonly id: string;
  readonly name: string;
  readonly brandId: string | null;
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
    /** Null for an upload that produced no billing row to attach a brand to. */
    readonly brandId: string | null;
    readonly id: string;
    readonly fileName: string;
  }[];
  readonly rows: readonly BillingScreenRow[];
  readonly anomalies: readonly BillingScreenAnomaly[];
  readonly approvedDifferences: readonly BillingScreenApprovedDifference[];
  readonly warnings: readonly string[];
  readonly franchisees: readonly BillingScreenFranchisee[];
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
  sources: readonly BillingSourceReviewRecord[],
): ReviewProjection {
  const reviews = sources.map((source) => ({
    source,
    review: parseReview(source.metadata),
  }));
  const names = new Map(
    rows.map((row) => [row.franchiseeId, row.franchiseeName]),
  );
  return {
    anomalies: reviews.flatMap(({ source, review }) =>
      review.anomalies.map((finding) => ({
        ...finding,
        sourceFileId: source.id,
        sourceFileName: source.fileName,
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
  const calculation = calculateRoyalty({
    receipts: Number(billing.receipts),
    tips: Number(billing.tips),
    includeTips: billing.includeTips,
    tiers: billing.tiers,
    tierBasis: billing.tierBasis,
    marketingRate: Number(billing.marketingRate),
    discountRatePoints,
    vat,
  });
  if (discountRatePoints > calculation.tierRate) {
    throw new Error("הדחייה לא יכולה להיות גבוהה מתעריף המדרגה");
  }
  return {
    discountRatePoints,
    effectiveRate: calculation.effectiveRate,
    royalty: calculation.royalty,
    discountValue: calculation.discountValue,
    subtotal: calculation.subtotal,
    total: calculation.total,
  };
}

export async function loadFranchiseeBillingScreen(
  period: FranchiseeBillingPeriod,
  operations?: BillingScreenOperations,
): Promise<FranchiseeBillingScreenData> {
  const activeOperations = operations ?? await defaultOperations();
  const [{ rows, sourcesByBrand, unlinkedSources }, franchisees] =
    await Promise.all([
      activeOperations.readPeriodSnapshot(period),
      activeOperations.readBillableFranchisees(),
    ]);
  const sourceFiles = [
    ...[...sourcesByBrand].map(([brandId, source]) => ({
      brandId: brandId as string | null,
      id: source.id,
      fileName: source.fileName,
    })),
    ...unlinkedSources.map((source) => ({
      brandId: null,
      id: source.id,
      fileName: source.fileName,
    })),
  ];
  const reviewProjection = projectSourceReviews(rows, [
    ...sourcesByBrand.values(),
    ...unlinkedSources,
  ]);
  return {
    period,
    sourceFiles,
    rows,
    franchisees,
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

/**
 * Cancels one royalty upload: its drafts go, and the file itself stops
 * counting as a source for the month. A file whose findings cannot be fixed
 * from the screen would otherwise block approval forever, with re-uploading
 * powerless against it — a second file only supersedes a first of the same
 * brand, and a file that named no franchisee has no brand.
 *
 * Approved rows are the line. They carry an invoice and a ledger entry, so the
 * month has to be reopened before its source can be thrown away.
 */
export async function discardBillingSourceFile(
  sourceFileId: string,
  operations?: BillingScreenOperations,
): Promise<MutationResult<{ readonly sourceFileId: string }>> {
  const activeOperations = operations ?? await defaultOperations();
  const result = await activeOperations.discardSourceFile(sourceFileId);
  if (result === "not_found") {
    return failure("not_found", "קובץ המקור לא נמצא");
  }
  if (result === "approved") {
    return failure(
      "approved",
      "לקובץ יש שורות מאושרות. יש לפתוח אותן מחדש לפני ביטול הקובץ",
    );
  }
  return { success: true, data: { sourceFileId } };
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
