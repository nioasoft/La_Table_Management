import { and, desc, eq, lte, notExists, sql } from "drizzle-orm";
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
  selectLiveUnlinkedSources,
} from "@/data-access/franchisee-billing-screen-queries";
import type {
  BillingDiscountContext,
  BillingNoRevenueContext,
  BillingScreenFranchisee,
  BillingScreenOperations,
  BillingScreenRow,
  BillingSourceReviewRecord,
  BillingSourceReviewsByBrand,
  DifferenceResolutionContext,
  DiscardSourceFileResult,
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
  selectLiveUnlinkedSources,
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
      const orderedLinked = await createLatestSourceReviewsQuery(tx, period);
      const sourcesByBrand = mapLatestSourceReviewsByBrand(orderedLinked);
      const rows = await readPeriodRows(tx, period, sourcesByBrand);
      const unlinkedSources = selectLiveUnlinkedSources(
        await createUnlinkedSourcesQuery(tx, period),
        orderedLinked,
      );
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

/**
 * A re-upload over a fully approved month writes no billing rows — every one
 * is skipped as approved — so the file never enters the brand's linked map,
 * and its differences were unreachable: the screen showed them, resolving
 * them 404'd. Such a file is accepted here as the difference's source as long
 * as it is a live (not cancelled) royalty upload that nothing links to.
 */
async function readUnlinkedDifferenceSource(
  database: BillingReadDatabase,
  sourceFileId: string,
): Promise<BillingSourceReviewRecord | null> {
  const source = schema.uploadedFile;
  const [row] = await database
    .select({
      id: source.id,
      fileName: source.originalFileName,
      metadata: source.metadata,
    })
    .from(source)
    .where(
      and(
        eq(source.id, sourceFileId),
        sql`${source.metadata}->>'documentType' = ${"franchisee_royalty_revenue"}`,
        sql`${source.processingStatus} is distinct from 'rejected'::uploaded_file_review_status`,
        notExists(
          database
            .select({ one: sql`1` })
            .from(schema.franchiseeBilling)
            .where(eq(schema.franchiseeBilling.sourceFileId, sourceFileId)),
        ),
      ),
    )
    .limit(1);
  return row ?? null;
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
  const source =
    resolveLiveSourceReview(sourcesByBrand, brandId, sourceFileId) ??
    (await readUnlinkedDifferenceSource(database, sourceFileId));
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

/**
 * Cancels one royalty upload inside a single transaction: the drafts it wrote
 * are deleted, and the file is marked rejected so neither source query counts
 * it again. The row itself stays — it is the record that the file arrived.
 *
 * ponytail: the stored workbook is left in storage. Nothing reads it once the
 * file is rejected, and keeping it means a mistaken discard can still be
 * inspected.
 */
async function discardSourceFile(
  database: BillingDatabase,
  sourceFileId: string,
): Promise<DiscardSourceFileResult> {
  const billing = schema.franchiseeBilling;
  const source = schema.uploadedFile;
  return database.transaction(async (tx) => {
    const [stored] = await tx
      .select({ id: source.id })
      .from(source)
      .where(
        and(
          eq(source.id, sourceFileId),
          sql`${source.metadata}->>'documentType' = ${"franchisee_royalty_revenue"}`,
        ),
      )
      .limit(1);
    if (!stored) return "not_found";

    const [approved] = await tx
      .select({ id: billing.id })
      .from(billing)
      .where(
        and(
          eq(billing.sourceFileId, sourceFileId),
          eq(billing.status, "approved"),
        ),
      )
      .limit(1);
    if (approved) return "approved";

    await tx
      .delete(billing)
      .where(
        and(
          eq(billing.sourceFileId, sourceFileId),
          eq(billing.status, "draft"),
        ),
      );
    await tx
      .update(source)
      .set({ processingStatus: "rejected", reviewedAt: new Date() })
      .where(eq(source.id, sourceFileId));
    return "success";
  });
}

/**
 * The franchisees a blocked row may be assigned to — exactly the set the
 * matcher itself resolves against, so the picker can never offer a franchisee
 * the replay would then refuse.
 */
async function readBillableFranchisees(
  database: BillingDatabase,
): Promise<readonly BillingScreenFranchisee[]> {
  return database
    .select({
      id: schema.franchisee.id,
      name: schema.franchisee.name,
      brandId: schema.franchisee.brandId,
    })
    .from(schema.franchisee)
    .where(eq(schema.franchisee.category, "regular"))
    .orderBy(schema.franchisee.name);
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
    discardSourceFile: (sourceFileId) =>
      discardSourceFile(database, sourceFileId),
    readBillableFranchisees: () => readBillableFranchisees(database),
  };
}
