import { and, desc, eq, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { NextRequest, NextResponse } from "next/server";

import * as schema from "@/db/schema";
import {
  createLatestSourceReviewsQuery,
  mapLatestSourceReviewsByBrand,
} from "@/data-access/franchisee-billing-screen-queries";
import {
  calculateCanonicalApproval,
  validateApprovalCalculation,
  type ApprovalBillingRow,
  type ApprovalFinancialField,
  type ApprovalPeriod,
  type ApprovalSourceReview,
  type ApprovalStore,
  type CanonicalApprovalCalculation,
  type FranchiseeBillingApprovalOperations,
  type LedgerEntryInput,
  type PersistBillingApprovalInput,
} from "@/lib/franchisee-billing-approval";
import { isAuthError, requireSuperUser } from "@/lib/api-middleware";
import {
  checkRateLimit,
  createRateLimitHeaders,
  getClientIP,
  RateLimitConfigs,
} from "@/lib/rate-limit";
import {
  franchiseeBillingApprovalSchema,
  type FranchiseeBillingApproveInput,
} from "@/schemas/franchisee-billing-approval";
import { franchiseeBillingSourceReviewSchema } from "@/schemas/franchisee-billing-screen";

export type {
  ApprovalBillingRow,
  ApprovalSourceReview,
  ApprovalStore,
  FranchiseeBillingApprovalOperations,
  LedgerEntryInput,
  PersistBillingApprovalInput,
} from "@/lib/franchisee-billing-approval";

export const runtime = "nodejs";
interface ApprovalArtifact {
  readonly row: ApprovalBillingRow;
  readonly snapshot: PersistBillingApprovalInput;
  readonly calculation: CanonicalApprovalCalculation;
}
const FINANCIAL_FIELD_LABELS: Readonly<Record<ApprovalFinancialField, string>> = {
  grossBase: "מחזור כולל מע״מ",
  netBase: "מחזור ללא מע״מ",
  tierRate: "אחוז מדרגה",
  effectiveRate: "אחוז בפועל",
  royaltyFull: "תמלוגים לפי הסכם",
  royalty: "תמלוגים לחיוב",
  discountValue: "דחיית חיוב",
  marketing: "דמי שיווק",
  subtotal: "סכום ביניים",
  total: "לתשלום",
};
type TransactionResult =
  | { readonly kind: "not_found" }
  | { readonly kind: "already_approved" }
  | { readonly kind: "blocked"; readonly error: string }
  | {
      readonly kind: "approved";
      readonly billingCount: number;
      readonly ledgerEntriesCreated: number;
    };
class ApprovalConflictError extends Error {}
function isPositive(value: string): boolean {
  return Number(value) > 0;
}
function sourceBlockReason(
  rows: readonly ApprovalBillingRow[],
  sourcesByBrand: ReadonlyMap<string, ApprovalSourceReview>,
): string | null {
  // A month billed only from one-restaurant files has no brand-wide file to
  // demand — each of those rows answers to its own file.
  if (sourcesByBrand.size === 0 && rows.some((row) => !row.sourceSingleBranch)) {
    return "אין קובץ מקור פעיל לחודש שנבחר";
  }
  const reviews = [...sourcesByBrand.values()].map((source) =>
    franchiseeBillingSourceReviewSchema.safeParse(source.metadata),
  );
  if (reviews.some((review) => !review.success)) {
    return "בדיקת אחד מקובצי המקור אינה תקינה";
  }
  const stale = rows.filter(
    (row) =>
      !row.sourceSingleBranch &&
      row.sourceFileId !== sourcesByBrand.get(row.brandId)?.id,
  );
  if (stale.length > 0) {
    return `יש ${stale.length} שורות שמבוססות על קובץ ישן: ${stale.map((row) => row.franchiseeName).join(", ")}`;
  }
  const anomalyCount = reviews.reduce(
    (count, review) => count + (review.success ? review.data.anomalies.length : 0),
    0,
  );
  if (anomalyCount > 0) {
    return `יש ${anomalyCount} חריגות חוסמות בקבצים האחרונים`;
  }
  const differenceCount = reviews.reduce(
    (count, review) =>
      count + (review.success ? review.data.approvedDifferences.length : 0),
    0,
  );
  if (differenceCount > 0) {
    return `יש ${differenceCount} פערים שטרם נפתרו מול חיובים מאושרים`;
  }
  return null;
}
function snapshotFor(
  row: ApprovalBillingRow,
  vatRate: string,
  approvedAt: Date,
  approvedBy: string,
): PersistBillingApprovalInput | string {
  const accountKey = row.hashavshevetAccountKey?.trim();
  // A zero-rate franchisee (Natanzon) bills nothing, so nothing of it ever
  // reaches Hashavshevet — an export account key would never be read.
  const billsNothing = [row.royalty, row.marketing, row.total].every(
    (value) => Number(value) === 0,
  );
  if (!row.royaltyTiers?.length || !row.royaltyTiersConfirmed) {
    return `מדרגות התמלוגים של ${row.franchiseeName} אינן מאושרות`;
  }
  if (row.marketingFeeRate === null || (!accountKey && !billsNothing)) {
    return `חסרה הגדרת חיוב לזכיין ${row.franchiseeName}`;
  }
  return {
    billingId: row.id,
    tiersSnapshot: row.royaltyTiers,
    tierBasisSnapshot: row.royaltyTierBasis,
    marketingRateSnapshot: row.marketingFeeRate,
    vatRateSnapshot: vatRate,
    accountKeySnapshot: accountKey ?? null,
    approvedAt,
    approvedBy,
  };
}
function mismatchMessage(
  row: ApprovalBillingRow,
  validation: ReturnType<typeof validateApprovalCalculation>,
): string {
  if (validation.success) return "";
  const mismatch = validation.mismatch;
  return [
    `שורת ${row.franchiseeName} דורשת חישוב מחדש.`,
    `השדה ${FINANCIAL_FIELD_LABELS[mismatch.field]} (${mismatch.field}) שונה: נשמר ${mismatch.stored},`,
    `חושב ${mismatch.calculated}, פער ${mismatch.difference}.`,
  ].join(" ");
}
async function approveWithinTransaction(
  input: FranchiseeBillingApproveInput,
  approvedBy: string,
  store: ApprovalStore,
): Promise<TransactionResult> {
  const period = { year: input.periodYear, month: input.periodMonth };
  const rows = await store.loadRowsForUpdate(period);
  if (rows.length === 0) return { kind: "not_found" };
  // Brands land at different times, so a month with rows already approved is a
  // normal state, not a corrupt one: approval takes whatever is still a draft
  // and leaves the approved rows exactly as they are.
  const drafts = rows.filter((row) => row.status === "draft");
  if (drafts.length === 0) {
    return { kind: "already_approved" };
  }
  const sourceReason = sourceBlockReason(
    drafts,
    await store.loadLatestSources(period),
  );
  if (sourceReason) return { kind: "blocked", error: sourceReason };
  const vatRate = await store.loadVatRate(period);
  if (vatRate === null) {
    return { kind: "blocked", error: "לא נמצא שיעור מע״מ לחודש שנבחר" };
  }
  return calculateAndPersist(drafts, vatRate, approvedBy, store);
}
async function calculateAndPersist(
  rows: readonly ApprovalBillingRow[],
  vatRate: string,
  approvedBy: string,
  store: ApprovalStore,
): Promise<TransactionResult> {
  const approvedAt = new Date();
  const artifacts = buildApprovalArtifacts(
    rows,
    vatRate,
    approvedAt,
    approvedBy,
  );
  if (typeof artifacts === "string") {
    return { kind: "blocked", error: artifacts };
  }
  for (const artifact of artifacts) {
    if (!await store.persistApproval(artifact.snapshot)) {
      throw new ApprovalConflictError();
    }
  }
  return persistApprovalArtifacts(artifacts, approvedBy, store);
}
function buildApprovalArtifacts(
  rows: readonly ApprovalBillingRow[],
  vatRate: string,
  approvedAt: Date,
  approvedBy: string,
): readonly ApprovalArtifact[] | string {
  const artifacts: ApprovalArtifact[] = [];
  for (const row of rows) {
    const snapshot = snapshotFor(row, vatRate, approvedAt, approvedBy);
    if (typeof snapshot === "string") return snapshot;
    const validation = validateApprovalCalculation(row, {
      tiers: snapshot.tiersSnapshot,
      tierBasis: snapshot.tierBasisSnapshot,
      marketingRate: Number(snapshot.marketingRateSnapshot),
      vat: Number(snapshot.vatRateSnapshot),
    });
    if (!validation.success) {
      return mismatchMessage(row, validation);
    }
    artifacts.push({ row, snapshot, calculation: validation.calculation });
  }
  return artifacts;
}
async function persistApprovalArtifacts(
  artifacts: readonly ApprovalArtifact[],
  approvedBy: string,
  store: ApprovalStore,
): Promise<TransactionResult> {
  const ledger = artifacts
    .filter(({ calculation }) => isPositive(calculation.discountValue))
    .map(({ row, calculation }) => ({
    billingId: row.id,
    franchiseeId: row.franchiseeId,
    amount: calculation.discountValue,
    createdBy: approvedBy,
    note: `דחיית חיוב · ${row.periodMonth}/${row.periodYear}`,
  }));
  await store.insertLedger(ledger);
  return {
    kind: "approved",
    billingCount: artifacts.length,
    ledgerEntriesCreated: ledger.length,
  };
}
type ApprovalDatabase = NodePgDatabase<typeof schema>;
export function createLockedApprovalRowsQuery(
  database: Pick<ApprovalDatabase, "select">,
  period: ApprovalPeriod,
) {
  const billing = schema.franchiseeBilling;
  const franchisee = schema.franchisee;
  return database.select({
    id: billing.id,
    franchiseeId: billing.franchiseeId,
    franchiseeName: franchisee.name,
    brandId: franchisee.brandId,
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
    sourceFileId: billing.sourceFileId,
    // A correlated subquery instead of a join: FOR UPDATE cannot lock the
    // nullable side of an outer join, and the file row needs no lock.
    sourceSingleBranch: sql<boolean>`coalesce((
      select ${schema.uploadedFile.metadata}->>'singleBranch'
      from ${schema.uploadedFile}
      where ${schema.uploadedFile.id} = ${billing.sourceFileId}
    ), '') = 'true'`,
    status: billing.status,
    royaltyTiers: franchisee.royaltyTiers,
    royaltyTierBasis: franchisee.royaltyTierBasis,
    royaltyTiersConfirmed: franchisee.royaltyTiersConfirmed,
    marketingFeeRate: franchisee.marketingFeeRate,
    hashavshevetAccountKey: franchisee.hashavshevetAccountKey,
    owners: franchisee.owners,
    tiersSnapshot: billing.tiersSnapshot,
    tierBasisSnapshot: billing.tierBasisSnapshot,
    marketingRateSnapshot: billing.marketingRateSnapshot,
    vatRateSnapshot: billing.vatRateSnapshot,
    accountKeySnapshot: billing.accountKeySnapshot,
  }).from(billing).innerJoin(
    franchisee,
    eq(billing.franchiseeId, franchisee.id),
  ).where(and(
    eq(billing.periodYear, period.year),
    eq(billing.periodMonth, period.month),
  )).for("update");
}
export function createPersistApprovalQuery(
  database: Pick<ApprovalDatabase, "update">,
  input: PersistBillingApprovalInput,
) {
  return database.update(schema.franchiseeBilling).set({
    tiersSnapshot: input.tiersSnapshot,
    tierBasisSnapshot: input.tierBasisSnapshot,
    marketingRateSnapshot: input.marketingRateSnapshot,
    vatRateSnapshot: input.vatRateSnapshot,
    accountKeySnapshot: input.accountKeySnapshot,
    status: "approved",
    approvedAt: input.approvedAt,
    approvedBy: input.approvedBy,
  }).where(and(
    eq(schema.franchiseeBilling.id, input.billingId),
    eq(schema.franchiseeBilling.status, "draft"),
  )).returning({ id: schema.franchiseeBilling.id });
}
function approvalStore(database: ApprovalDatabase): ApprovalStore {
  return {
    loadRowsForUpdate: (period) =>
      createLockedApprovalRowsQuery(database, period),
    loadLatestSources: async (period) => {
      const sources = await createLatestSourceReviewsQuery(
        database,
        period,
      ).for("share");
      return mapLatestSourceReviewsByBrand(sources);
    },
    loadVatRate: async (period) => {
      const periodStart = `${period.year}-${String(period.month).padStart(2, "0")}-01`;
      const [row] = await database.select({
        rate: schema.vatRate.rate,
      }).from(schema.vatRate).where(
        lte(schema.vatRate.effectiveFrom, periodStart),
      ).orderBy(desc(schema.vatRate.effectiveFrom)).limit(1);
      return row?.rate ?? null;
    },
    persistApproval: async (input) => {
      const [updated] = await createPersistApprovalQuery(database, input);
      return Boolean(updated);
    },
    insertLedger: async (entries) => {
      if (entries.length === 0) return;
      await database.insert(schema.franchiseeDeferralLedger).values([...entries]);
    },
  };
}
async function defaultOperations(): Promise<FranchiseeBillingApprovalOperations> {
  const { database } = await import("@/db");
  return {
    withTransaction: <T>(work: (store: ApprovalStore) => Promise<T>) =>
      database.transaction(
        (tx) => work(approvalStore(tx)),
        { isolationLevel: "serializable" },
      ),
  };
}

function responseData(result: TransactionResult) {
  return {
    approvalCommitted: result.kind === "approved",
    alreadyApproved: result.kind === "already_approved",
    billingsApproved: result.kind === "approved" ? result.billingCount : 0,
    ledgerEntriesCreated:
      result.kind === "approved" ? result.ledgerEntriesCreated : 0,
  };
}

function rateLimitResponse(
  request: NextRequest,
  requestId: string,
): NextResponse | null {
  const limit = checkRateLimit(
    `franchisee-billing-approve:${getClientIP(request)}`,
    RateLimitConfigs.api,
  );
  if (limit.success) return null;
  return NextResponse.json(
    {
      success: false,
      error: "בוצעו יותר מדי בקשות. נסי שוב בעוד דקה",
      requestId,
    },
    { status: 429, headers: createRateLimitHeaders(limit) },
  );
}

function unexpectedResponse(error: unknown, requestId: string): NextResponse {
  const isSerializationConflict =
    typeof error === "object" &&
    error !== null &&
    "code" in error &&
    error.code === "40001";
  const status =
    error instanceof ApprovalConflictError || isSerializationConflict
      ? 409
      : 500;
  console.error("[franchisee-billing-approve] Request failed", {
    requestId,
    error,
  });
  return NextResponse.json({
    success: false,
    error: status === 409
      ? "נתוני החיוב השתנו. רענני את העמוד ונסי שוב"
      : `אירעה שגיאה זמנית באישור החיובים. קוד פנייה: ${requestId}`,
    requestId,
  }, { status });
}

function approvalResponse(
  result: TransactionResult,
  requestId: string,
): NextResponse {
  if (result.kind === "not_found") {
    return NextResponse.json(
      { success: false, error: "לא נמצאו חיובים לחודש שנבחר", requestId },
      { status: 404 },
    );
  }
  if (result.kind === "blocked") {
    return NextResponse.json(
      { success: false, error: result.error, requestId },
      { status: 409 },
    );
  }
  return NextResponse.json({
    success: true,
    data: responseData(result),
    requestId,
  });
}

/**
 * Approves one billing month atomically. Nothing is sent to the franchisees —
 * the approval only writes the billing rows and the deferral ledger.
 */
export async function handleApproveFranchiseeBilling(
  request: NextRequest,
  injectedOperations?: FranchiseeBillingApprovalOperations,
): Promise<NextResponse> {
  const requestId = request.headers.get("x-vercel-id") ?? crypto.randomUUID();
  const startedAt = Date.now();
  const finish = (response: NextResponse) => {
    console.info(JSON.stringify({
      event: "franchisee_billing_approve",
      requestId,
      status: response.status,
      latencyMs: Date.now() - startedAt,
    }));
    return response;
  };
  const authResult = await requireSuperUser(request);
  if (isAuthError(authResult)) return finish(authResult);
  const limited = rateLimitResponse(request, requestId);
  if (limited) return finish(limited);
  try {
    const body: unknown = await request.json();
    const validation = franchiseeBillingApprovalSchema.safeParse(body);
    if (!validation.success) {
      return finish(NextResponse.json(
        { success: false, error: "בקשת האישור אינה תקינה", requestId },
        { status: 400 },
      ));
    }
    const operations = injectedOperations ?? await defaultOperations();
    const approvalInput = validation.data;
    const result = await operations.withTransaction((store) =>
      approveWithinTransaction(approvalInput, authResult.user.id, store));
    return finish(approvalResponse(result, requestId));
  } catch (error: unknown) {
    return finish(unexpectedResponse(error, requestId));
  }
}

/**
 * Next passes a route context as the second argument. Aliasing POST directly to
 * the handler fed that context into the tests-only operations parameter, so
 * every real approval crashed on operations.withTransaction.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleApproveFranchiseeBilling(request);
}
