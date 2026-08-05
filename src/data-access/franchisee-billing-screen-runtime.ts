import { and, desc, eq, lte } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import * as schema from "@/db/schema";
import {
  createDeleteBillingLedgerQuery,
  createDiscountContextQuery,
  createLatestSourceReviewsQuery,
  createNoRevenueReasonUpdateQuery,
  createPeriodRowsQuery,
  createReopenBillingQuery,
  createSourceReviewUpdateQuery,
  createUnlinkedSourcesQuery,
  formatBillingPeriodDate,
  mapLatestSourceReviewsByBrand,
} from "@/data-access/franchisee-billing-screen-queries";
import type {
  BillingDiscountContext,
  BillingNoRevenueContext,
  BillingScreenOperations,
  BillingScreenRow,
  BillingSourceReviewRecord,
  BillingSourceReviewsByBrand,
  DifferenceResolutionContext,
  PersistDifferenceResolutionInput,
  PersistDifferenceResolutionResult,
  PersistDiscountInput,
  PersistNoRevenueReasonInput,
  ReopenableBilling,
  ReopenedBillingValues,
} from "@/data-access/franchisee-billing-screen";
import type { FranchiseeBillingPeriod } from "@/schemas/franchisee-billing-screen";

export {
  createDeleteBillingLedgerQuery,
  createDiscountContextQuery,
  createLatestSourceReviewsQuery,
  createNoRevenueReasonUpdateQuery,
  createPeriodRowsQuery,
  createReopenBillingQuery,
  createSourceReviewUpdateQuery,
  createUnlinkedSourcesQuery,
  mapLatestSourceReviewsByBrand,
} from "@/data-access/franchisee-billing-screen-queries";

async function loadDatabaseRuntime() {
  return import("@/db");
}

type BillingDatabase = Awaited<
  ReturnType<typeof loadDatabaseRuntime>
>["database"];
type BillingReadDatabase = Pick<NodePgDatabase<typeof schema>, "select">;

export function resolveLiveSourceReview(
  sourcesByBrand: BillingSourceReviewsByBrand,
  brandId: string,
  requestedSourceFileId: string,
): BillingSourceReviewRecord | null {
  const source = sourcesByBrand.get(brandId);
  return source?.id === requestedSourceFileId ? source : null;
}

async function readPeriodRows(
  database: BillingReadDatabase,
  period: FranchiseeBillingPeriod,
  sourcesByBrand: BillingSourceReviewsByBrand,
): Promise<readonly BillingScreenRow[]> {
  return createPeriodRowsQuery(database, period, sourcesByBrand);
}

async function readLatestSourceReview(
  database: BillingReadDatabase,
  period: FranchiseeBillingPeriod,
): Promise<BillingSourceReviewsByBrand> {
  const sources = await createLatestSourceReviewsQuery(database, period);
  return mapLatestSourceReviewsByBrand(sources);
}

async function readPeriodSnapshot(
  database: BillingDatabase,
  period: FranchiseeBillingPeriod,
) {
  return database.transaction(
    async (tx) => {
      const sourcesByBrand = await readLatestSourceReview(tx, period);
      const rows = await readPeriodRows(tx, period, sourcesByBrand);
      const unlinkedSources = await createUnlinkedSourcesQuery(tx, period);
      return { rows, sourcesByBrand, unlinkedSources };
    },
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

async function readDiscountContext(
  database: BillingDatabase,
  billingId: string,
): Promise<BillingDiscountContext | null> {
  const [row] = await createDiscountContextQuery(database, billingId);
  if (!row?.tiers || row.marketingRate === null) return null;
  return {
    ...row,
    tiers: row.tiers,
    marketingRate: row.marketingRate,
  };
}

async function readVatRate(
  database: BillingDatabase,
  period: FranchiseeBillingPeriod,
): Promise<number | null> {
  const [row] = await database
    .select({ rate: schema.vatRate.rate })
    .from(schema.vatRate)
    .where(
      lte(
        schema.vatRate.effectiveFrom,
        formatBillingPeriodDate(period.year, period.month, 1),
      ),
    )
    .orderBy(desc(schema.vatRate.effectiveFrom))
    .limit(1);
  return row ? Number(row.rate) : null;
}

async function persistDiscount(
  database: BillingDatabase,
  input: PersistDiscountInput,
): Promise<boolean> {
  const billing = schema.franchiseeBilling;
  const [updated] = await database
    .update(billing)
    .set({
      discountRatePoints: input.discountRatePoints,
      effectiveRate: input.effectiveRate,
      royalty: input.royalty,
      discountValue: input.discountValue,
      subtotal: input.subtotal,
      total: input.total,
    })
    .where(
      and(
        eq(billing.id, input.billingId),
        eq(billing.status, "draft"),
      ),
    )
    .returning({ id: billing.id });
  return Boolean(updated);
}

async function readNoRevenueContext(
  database: BillingDatabase,
  billingId: string,
): Promise<BillingNoRevenueContext | null> {
  const billing = schema.franchiseeBilling;
  const [row] = await database
    .select({
      id: billing.id,
      status: billing.status,
      royalty: billing.royalty,
      marketing: billing.marketing,
      total: billing.total,
    })
    .from(billing)
    .where(eq(billing.id, billingId))
    .limit(1);
  return row ?? null;
}

async function persistNoRevenueReason(
  database: BillingDatabase,
  input: PersistNoRevenueReasonInput,
): Promise<boolean> {
  const [updated] = await createNoRevenueReasonUpdateQuery(
    database,
    input,
  ).returning({ id: schema.franchiseeBilling.id });
  return Boolean(updated);
}

function parsePeriodStart(
  periodStartDate: string | null,
): FranchiseeBillingPeriod | null {
  const match = periodStartDate?.match(/^(\d{4})-(\d{2})-\d{2}$/);
  if (!match) return null;
  const year = Number(match[1]);
  const month = Number(match[2]);
  return Number.isInteger(year) && month >= 1 && month <= 12
    ? { year, month }
    : null;
}

async function readApprovedBilling(
  database: BillingReadDatabase,
  franchiseeId: string,
  period: FranchiseeBillingPeriod,
): Promise<ReopenableBilling | null> {
  const billing = schema.franchiseeBilling;
  const [row] = await database
    .select({
      id: billing.id,
      franchiseeId: billing.franchiseeId,
      periodYear: billing.periodYear,
      periodMonth: billing.periodMonth,
      receipts: billing.receipts,
      tips: billing.tips,
      includeTips: billing.includeTips,
      grossBase: billing.grossBase,
      netBase: billing.netBase,
      tierRate: billing.tierRate,
      discountRatePoints: billing.discountRatePoints,
      effectiveRate: billing.effectiveRate,
      royaltyFull: billing.royaltyFull,
      royalty: billing.royalty,
      discountValue: billing.discountValue,
      marketing: billing.marketing,
      subtotal: billing.subtotal,
      total: billing.total,
      tiersSnapshot: billing.tiersSnapshot,
      tierBasisSnapshot: billing.tierBasisSnapshot,
      marketingRateSnapshot: billing.marketingRateSnapshot,
      vatRateSnapshot: billing.vatRateSnapshot,
      royaltyExportedAt: billing.royaltyExportedAt,
      royaltyExportBatchId: billing.royaltyExportBatchId,
      marketingExportedAt: billing.marketingExportedAt,
      marketingExportBatchId: billing.marketingExportBatchId,
      status: billing.status,
    })
    .from(billing)
    .where(
      and(
        eq(billing.franchiseeId, franchiseeId),
        eq(billing.periodYear, period.year),
        eq(billing.periodMonth, period.month),
        eq(billing.status, "approved"),
      ),
    )
    .limit(1);
  return row ?? null;
}

async function readRequestedSourcePeriod(
  database: BillingReadDatabase,
  sourceFileId: string,
): Promise<FranchiseeBillingPeriod | null> {
  const [source] = await database
    .select({ periodStartDate: schema.uploadedFile.periodStartDate })
    .from(schema.uploadedFile)
    .where(eq(schema.uploadedFile.id, sourceFileId))
    .limit(1);
  return parsePeriodStart(source?.periodStartDate ?? null);
}

async function readFranchiseeBrandId(
  database: BillingReadDatabase,
  franchiseeId: string,
): Promise<string | null> {
  const [franchisee] = await database
    .select({ brandId: schema.franchisee.brandId })
    .from(schema.franchisee)
    .where(eq(schema.franchisee.id, franchiseeId))
    .limit(1);
  return franchisee?.brandId ?? null;
}

async function readLiveDifferenceContext(
  database: BillingReadDatabase,
  sourceFileId: string,
  franchiseeId: string,
): Promise<DifferenceResolutionContext | null> {
  const [period, brandId] = await Promise.all([
    readRequestedSourcePeriod(database, sourceFileId),
    readFranchiseeBrandId(database, franchiseeId),
  ]);
  if (!period || !brandId) return null;
  const sourcesByBrand = await readLatestSourceReview(database, period);
  const source = resolveLiveSourceReview(
    sourcesByBrand,
    brandId,
    sourceFileId,
  );
  if (!source) return null;
  const billing = await readApprovedBilling(database, franchiseeId, period);
  return billing ? { source, billing } : null;
}

async function readDifferenceContext(
  database: BillingDatabase,
  sourceFileId: string,
  franchiseeId: string,
): Promise<DifferenceResolutionContext | null> {
  return database.transaction(
    (tx) => readLiveDifferenceContext(tx, sourceFileId, franchiseeId),
    { isolationLevel: "repeatable read", accessMode: "read only" },
  );
}

class ResolutionConflictError extends Error {}

function isSerializationConflict(error: unknown): boolean {
  return (
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "40001"
  );
}

async function billingWasExported(
  database: BillingReadDatabase,
  billingId: string,
): Promise<boolean> {
  const billing = schema.franchiseeBilling;
  const [row] = await database
    .select({
      royaltyExportedAt: billing.royaltyExportedAt,
      royaltyExportBatchId: billing.royaltyExportBatchId,
      marketingExportedAt: billing.marketingExportedAt,
      marketingExportBatchId: billing.marketingExportBatchId,
    })
    .from(billing)
    .where(eq(billing.id, billingId))
    .limit(1);
  return Boolean(
    row?.royaltyExportedAt ||
    row?.royaltyExportBatchId ||
    row?.marketingExportedAt ||
    row?.marketingExportBatchId
  );
}

async function reopenAndReverseApproval(
  database: NodePgDatabase<typeof schema>,
  reopenedBilling: ReopenedBillingValues,
): Promise<PersistDifferenceResolutionResult> {
  const [updated] = await createReopenBillingQuery(
    database,
    reopenedBilling,
  ).returning({ id: schema.franchiseeBilling.id });
  if (!updated) {
    return await billingWasExported(database, reopenedBilling.billingId)
      ? "exported"
      : "conflict";
  }
  // A billing-linked ledger row is an approval artifact. Deleting it restores
  // the pre-approval balance, so reapproval creates one canonical entry.
  await createDeleteBillingLedgerQuery(database, reopenedBilling.billingId);
  return "success";
}

async function persistDifferenceResolution(
  database: BillingDatabase,
  input: PersistDifferenceResolutionInput,
): Promise<PersistDifferenceResolutionResult> {
  try {
    return await database.transaction(
      async (tx) => {
        if (input.reopenedBilling) {
          const reopened = await reopenAndReverseApproval(
            tx,
            input.reopenedBilling,
          );
          if (reopened !== "success") return reopened;
        }
        const needsReview =
          input.updatedMetadata.anomalies.length > 0 ||
          input.updatedMetadata.approvedDifferences.length > 0;
        const [updatedSource] = await createSourceReviewUpdateQuery(
          tx,
          input,
          needsReview,
        ).returning({ id: schema.uploadedFile.id });
        if (!updatedSource) throw new ResolutionConflictError();
        return "success";
      },
      { isolationLevel: "serializable" },
    );
  } catch (error: unknown) {
    if (
      error instanceof ResolutionConflictError ||
      isSerializationConflict(error)
    ) {
      return "conflict";
    }
    throw error;
  }
}

export async function createBillingScreenOperations(): Promise<BillingScreenOperations> {
  const { database } = await loadDatabaseRuntime();
  return {
    readPeriodSnapshot: (period) => readPeriodSnapshot(database, period),
    readDiscountContext: (billingId) =>
      readDiscountContext(database, billingId),
    readVatRate: (period) => readVatRate(database, period),
    persistDiscount: (input) => persistDiscount(database, input),
    readNoRevenueContext: (billingId) =>
      readNoRevenueContext(database, billingId),
    persistNoRevenueReason: (input) =>
      persistNoRevenueReason(database, input),
    readDifferenceContext: (sourceFileId, franchiseeId) =>
      readDifferenceContext(database, sourceFileId, franchiseeId),
    persistDifferenceResolution: (input) =>
      persistDifferenceResolution(database, input),
  };
}
