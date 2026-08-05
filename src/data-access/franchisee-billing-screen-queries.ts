import { and, asc, desc, eq, isNull, notExists, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import type {
  PersistDifferenceResolutionInput,
  PersistNoRevenueReasonInput,
  ReopenedBillingValues,
  BillingSourceReviewRow,
  BillingSourceReviewsByBrand,
} from "@/data-access/franchisee-billing-screen";
import * as schema from "@/db/schema";
import type { FranchiseeBillingPeriod } from "@/schemas/franchisee-billing-screen";

type BillingReadDatabase = Pick<NodePgDatabase<typeof schema>, "select">;
type BillingUpdateDatabase = Pick<NodePgDatabase<typeof schema>, "update">;
type BillingDeleteDatabase = Pick<NodePgDatabase<typeof schema>, "delete">;

export function formatBillingPeriodDate(
  year: number,
  month: number,
  day: number,
): string {
  return [
    String(year).padStart(4, "0"),
    String(month).padStart(2, "0"),
    String(day).padStart(2, "0"),
  ].join("-");
}

export function mapLatestSourceReviewsByBrand(
  orderedSources: readonly BillingSourceReviewRow[],
): BillingSourceReviewsByBrand {
  const newestSources = orderedSources.filter(
    (source, index) =>
      orderedSources.findIndex(
        (candidate) => candidate.brandId === source.brandId,
      ) === index,
  );
  return new Map(
    newestSources.map(({ brandId, ...source }) => [brandId, source]),
  );
}

export function createLatestSourceReviewsQuery(
  database: BillingReadDatabase,
  period: FranchiseeBillingPeriod,
) {
  const billing = schema.franchiseeBilling;
  const source = schema.uploadedFile;
  return database
    .select({
      brandId: schema.franchisee.brandId,
      id: source.id,
      fileName: source.originalFileName,
      metadata: source.metadata,
    })
    .from(source)
    .innerJoin(billing, eq(source.id, billing.sourceFileId))
    .innerJoin(
      schema.franchisee,
      eq(billing.franchiseeId, schema.franchisee.id),
    )
    .where(
      and(
        eq(billing.periodYear, period.year),
        eq(billing.periodMonth, period.month),
        sql`${source.metadata}->>'documentType' = ${"franchisee_royalty_revenue"}`,
      ),
    )
    .orderBy(
      asc(schema.franchisee.brandId),
      desc(source.createdAt),
      desc(source.id),
    );
}

/**
 * Royalty uploads for the period that no billing row points at. The brand-keyed
 * query above reaches files through `franchisee_billing`, so a file whose rows
 * were all blocked is invisible to it.
 */
export function createUnlinkedSourcesQuery(
  database: BillingReadDatabase,
  period: FranchiseeBillingPeriod,
) {
  const source = schema.uploadedFile;
  const billing = schema.franchiseeBilling;
  return database
    .select({
      id: source.id,
      fileName: source.originalFileName,
      metadata: source.metadata,
    })
    .from(source)
    .where(
      and(
        eq(
          source.periodStartDate,
          formatBillingPeriodDate(period.year, period.month, 1),
        ),
        sql`${source.metadata}->>'documentType' = ${"franchisee_royalty_revenue"}`,
        notExists(
          database
            .select({ one: sql`1` })
            .from(billing)
            .where(eq(billing.sourceFileId, source.id)),
        ),
      ),
    )
    .orderBy(desc(source.createdAt), desc(source.id));
}

function activeSourceFileIdByBrand(
  sourcesByBrand: BillingSourceReviewsByBrand,
) {
  const branches = [...sourcesByBrand].map(([brandId, source]) =>
    sql`when ${brandId} then ${source.id}`,
  );
  // A month with no uploads at all leaves no branches, and `case x else null
  // end` is a Postgres syntax error. Every row is then stale by definition.
  if (branches.length === 0) return sql<string | null>`null`;
  return sql<string | null>`case ${schema.franchisee.brandId} ${sql.join(
    branches,
    sql.raw(" "),
  )} else null end`;
}

function billingRowSelection(
  sourcesByBrand: BillingSourceReviewsByBrand,
) {
  const billing = schema.franchiseeBilling;
  const ledger = schema.franchiseeDeferralLedger;
  const activeSourceFileId = activeSourceFileIdByBrand(sourcesByBrand);
  const isStale = sql<boolean>`${billing.sourceFileId} is distinct from ${activeSourceFileId}`;
  return {
    id: billing.id,
    franchiseeId: billing.franchiseeId,
    franchiseeName: schema.franchisee.name,
    periodYear: billing.periodYear,
    periodMonth: billing.periodMonth,
    grossBase: billing.grossBase,
    netBase: billing.netBase,
    tierRate: billing.tierRate,
    discountRatePoints: billing.discountRatePoints,
    discountValue: billing.discountValue,
    royalty: billing.royalty,
    marketing: billing.marketing,
    subtotal: billing.subtotal,
    total: billing.total,
    noRevenueReason: billing.noRevenueReason,
    deferralBalance: sql<string>`coalesce((
      select sum(${ledger.amount})
      from ${ledger}
      where ${ledger.franchiseeId} = ${billing.franchiseeId}
    ), 0)::text`,
    sourceFileId: billing.sourceFileId,
    sourceFileName: schema.uploadedFile.originalFileName,
    isStaleSource: isStale,
    isApprovalBlocked: isStale,
    status: billing.status,
    owners: schema.franchisee.owners,
  };
}

export function createPeriodRowsQuery(
  database: BillingReadDatabase,
  period: FranchiseeBillingPeriod,
  sourcesByBrand: BillingSourceReviewsByBrand,
) {
  const billing = schema.franchiseeBilling;
  return database
    .select(billingRowSelection(sourcesByBrand))
    .from(billing)
    .innerJoin(
      schema.franchisee,
      eq(billing.franchiseeId, schema.franchisee.id),
    )
    .leftJoin(
      schema.uploadedFile,
      eq(billing.sourceFileId, schema.uploadedFile.id),
    )
    .where(
      and(
        eq(billing.periodYear, period.year),
        eq(billing.periodMonth, period.month),
      ),
    )
    .orderBy(asc(schema.franchisee.name));
}

export function createDiscountContextQuery(
  database: BillingReadDatabase,
  billingId: string,
) {
  const billing = schema.franchiseeBilling;
  return database
    .select({
      id: billing.id,
      periodYear: billing.periodYear,
      periodMonth: billing.periodMonth,
      receipts: billing.receipts,
      tips: billing.tips,
      includeTips: billing.includeTips,
      tiers: schema.franchisee.royaltyTiers,
      tierBasis: schema.franchisee.royaltyTierBasis,
      marketingRate: schema.franchisee.marketingFeeRate,
      status: billing.status,
    })
    .from(billing)
    .innerJoin(
      schema.franchisee,
      eq(billing.franchiseeId, schema.franchisee.id),
    )
    .where(eq(billing.id, billingId))
    .limit(1);
}

export function createNoRevenueReasonUpdateQuery(
  database: BillingUpdateDatabase,
  input: PersistNoRevenueReasonInput,
) {
  const billing = schema.franchiseeBilling;
  const zeroAmountConditions = input.noRevenueReason
    ? [
        eq(billing.royalty, "0"),
        eq(billing.marketing, "0"),
        eq(billing.total, "0"),
      ]
    : [];
  return database
    .update(billing)
    .set({ noRevenueReason: input.noRevenueReason })
    .where(
      and(
        eq(billing.id, input.billingId),
        eq(billing.status, "draft"),
        ...zeroAmountConditions,
      ),
    );
}

function reopenedBillingSet(input: ReopenedBillingValues) {
  return {
    receipts: input.receipts,
    tips: input.tips,
    includeTips: input.includeTips,
    grossBase: input.grossBase,
    netBase: input.netBase,
    tierRate: input.tierRate,
    discountRatePoints: input.discountRatePoints,
    effectiveRate: input.effectiveRate,
    royaltyFull: input.royaltyFull,
    royalty: input.royalty,
    discountValue: input.discountValue,
    marketing: input.marketing,
    subtotal: input.subtotal,
    total: input.total,
    sourceFileId: input.sourceFileId,
    status: "draft" as const,
    tiersSnapshot: null,
    tierBasisSnapshot: null,
    marketingRateSnapshot: null,
    vatRateSnapshot: null,
    accountKeySnapshot: null,
    approvedAt: null,
    approvedBy: null,
    royaltyExportedAt: null,
    royaltyExportBatchId: null,
    marketingExportedAt: null,
    marketingExportBatchId: null,
  };
}

export function createReopenBillingQuery(
  database: BillingUpdateDatabase,
  input: ReopenedBillingValues,
) {
  const billing = schema.franchiseeBilling;
  return database
    .update(billing)
    .set(reopenedBillingSet(input))
    .where(
      and(
        eq(billing.id, input.billingId),
        eq(billing.status, "approved"),
        isNull(billing.royaltyExportedAt),
        isNull(billing.royaltyExportBatchId),
        isNull(billing.marketingExportedAt),
        isNull(billing.marketingExportBatchId),
      ),
    );
}

export function createDeleteBillingLedgerQuery(
  database: BillingDeleteDatabase,
  billingId: string,
) {
  return database
    .delete(schema.franchiseeDeferralLedger)
    .where(eq(schema.franchiseeDeferralLedger.billingId, billingId));
}

function liveSourceCondition(input: PersistDifferenceResolutionInput) {
  const periodStart = formatBillingPeriodDate(
    input.periodYear,
    input.periodMonth,
    1,
  );
  return sql`${schema.uploadedFile.id} = (
    select live_source.id
    from ${schema.uploadedFile} as live_source
    inner join ${schema.franchiseeBilling} as live_billing
      on live_billing.source_file_id = live_source.id
    inner join ${schema.franchisee} as live_franchisee
      on live_franchisee.id = live_billing.franchisee_id
    where live_source.period_start_date = ${periodStart}
      and live_source.metadata->>'documentType' = ${"franchisee_royalty_revenue"}
      and live_billing.period_year = ${input.periodYear}
      and live_billing.period_month = ${input.periodMonth}
      and live_franchisee.brand_id = (
        select requested_franchisee.brand_id
        from ${schema.franchisee} as requested_franchisee
        where requested_franchisee.id = ${input.franchiseeId}
      )
    order by live_source.created_at desc, live_source.id desc
    limit 1
  )`;
}

export function createSourceReviewUpdateQuery(
  database: BillingUpdateDatabase,
  input: PersistDifferenceResolutionInput,
  needsReview: boolean,
) {
  return database
    .update(schema.uploadedFile)
    .set({
      metadata: input.updatedMetadata,
      processingStatus: needsReview ? "needs_review" : "auto_approved",
    })
    .where(
      and(
        eq(schema.uploadedFile.id, input.sourceFileId),
        sql`${schema.uploadedFile.metadata} = ${JSON.stringify(input.expectedMetadata)}::jsonb`,
        liveSourceCondition(input),
      ),
    );
}
