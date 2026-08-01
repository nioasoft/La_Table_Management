import { render } from "@react-email/components";
import { and, desc, eq, inArray, lte, sql } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";
import { NextRequest, NextResponse } from "next/server";

import * as schema from "@/db/schema";
import {
  FranchiseeBillingEmail,
  franchiseeBillingEmailSubject,
  type FranchiseeBillingEmailProps,
} from "@/emails/franchisee-billing";
import {
  calculateCanonicalApproval,
  validateApprovalCalculation,
  type ApprovalBillingRow,
  type ApprovalEmailLog,
  type ApprovalEmailMessage,
  type ApprovalFinancialField,
  type ApprovalPeriod,
  type ApprovalSourceReview,
  type ApprovalStore,
  type CanonicalApprovalCalculation,
  type FranchiseeBillingApprovalOperations,
  type LedgerEntryInput,
  type PersistBillingApprovalInput,
  type RetryEmailContext,
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
  type FranchiseeBillingEmailFailure,
  type FranchiseeBillingRetryInput,
} from "@/schemas/franchisee-billing-approval";
import { franchiseeBillingSourceReviewSchema } from "@/schemas/franchisee-billing-screen";

export type {
  ApprovalBillingRow,
  ApprovalEmailLog,
  ApprovalEmailMessage,
  ApprovalSourceReview,
  ApprovalStore,
  FranchiseeBillingApprovalOperations,
  LedgerEntryInput,
  PersistBillingApprovalInput,
  RetryEmailContext,
} from "@/lib/franchisee-billing-approval";

export const runtime = "nodejs";
interface OwnerRecipient {
  readonly name: string;
  readonly email: string;
}
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
      readonly emails: readonly ApprovalEmailMessage[];
    };
class ApprovalConflictError extends Error {}
function normalizeEmail(value: string): string {
  return value.trim().toLowerCase();
}
function isPositive(value: string): boolean {
  return Number(value) > 0;
}
function ownerRecipients(
  row: ApprovalBillingRow,
  requested: readonly string[],
): readonly OwnerRecipient[] | string {
  const owners = new Map(
    (row.owners ?? [])
      .filter((owner) => typeof owner.email === "string" && owner.email.trim())
      .map((owner) => [normalizeEmail(owner.email ?? ""), owner]),
  );
  const recipients: OwnerRecipient[] = [];
  for (const email of requested) {
    const owner = owners.get(normalizeEmail(email));
    if (!owner) {
      return `הכתובת ${email} אינה שייכת לבעלים של ${row.franchiseeName}`;
    }
    if (recipients.some((item) => normalizeEmail(item.email) === normalizeEmail(email))) {
      continue;
    }
    recipients.push({
      name: owner.name.trim() || row.franchiseeName,
      email: owner.email?.trim() ?? email.trim(),
    });
  }
  return recipients;
}
function validateRecipients(
  rows: readonly ApprovalBillingRow[],
  input: FranchiseeBillingApproveInput,
): Map<string, readonly OwnerRecipient[]> | string {
  const rowsByFranchisee = new Map(rows.map((row) => [row.franchiseeId, row]));
  const result = new Map<string, readonly OwnerRecipient[]>();
  for (const requested of input.recipients) {
    const row = rowsByFranchisee.get(requested.franchiseeId);
    if (!row) return "רשימת הנמענים כוללת זכיין שאינו בחודש שנבחר";
    const validated = ownerRecipients(row, requested.emails);
    if (typeof validated === "string") return validated;
    result.set(row.franchiseeId, validated);
  }
  return result;
}
function sourceBlockReason(
  rows: readonly ApprovalBillingRow[],
  source: ApprovalSourceReview | null,
): string | null {
  if (!source) return "אין קובץ מקור פעיל לחודש שנבחר";
  const parsed = franchiseeBillingSourceReviewSchema.safeParse(source.metadata);
  if (!parsed.success) return "בדיקת קובץ המקור אינה תקינה";
  const stale = rows.filter((row) => row.sourceFileId !== source.id);
  if (stale.length > 0) {
    return `יש ${stale.length} שורות שמבוססות על קובץ ישן: ${stale.map((row) => row.franchiseeName).join(", ")}`;
  }
  if (parsed.data.anomalies.length > 0) {
    return `יש ${parsed.data.anomalies.length} חריגות חוסמות בקובץ האחרון`;
  }
  if (parsed.data.approvedDifferences.length > 0) {
    return `יש ${parsed.data.approvedDifferences.length} פערים שטרם נפתרו מול חיובים מאושרים`;
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
  if (!row.royaltyTiers?.length || !row.royaltyTiersConfirmed) {
    return `מדרגות התמלוגים של ${row.franchiseeName} אינן מאושרות`;
  }
  if (row.marketingFeeRate === null || !accountKey) {
    return `חסרה הגדרת חיוב לזכיין ${row.franchiseeName}`;
  }
  return {
    billingId: row.id,
    tiersSnapshot: row.royaltyTiers,
    tierBasisSnapshot: row.royaltyTierBasis,
    marketingRateSnapshot: row.marketingFeeRate,
    vatRateSnapshot: vatRate,
    accountKeySnapshot: accountKey,
    approvedAt,
    approvedBy,
  };
}
function emailProps(
  row: ApprovalBillingRow,
  recipient: OwnerRecipient,
  values: CanonicalApprovalCalculation,
  marketingRateSnapshot: string,
): FranchiseeBillingEmailProps {
  return {
    ownerName: recipient.name,
    franchiseeName: row.franchiseeName,
    periodYear: row.periodYear,
    periodMonth: row.periodMonth,
    grossBase: values.grossBase,
    netBase: values.netBase,
    tierRate: values.tierRate,
    discountRatePoints: row.discountRatePoints,
    effectiveRate: values.effectiveRate,
    royaltyFull: values.royaltyFull,
    discountValue: values.discountValue,
    royalty: values.royalty,
    marketingRateSnapshot,
    marketing: values.marketing,
    subtotal: values.subtotal,
    total: values.total,
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
  if (rows.every((row) => row.status === "approved")) {
    return { kind: "already_approved" };
  }
  if (rows.some((row) => row.status !== "draft")) {
    return { kind: "blocked", error: "החודש נמצא במצב אישור חלקי ואינו ניתן לאישור" };
  }
  const sourceReason = sourceBlockReason(
    rows,
    await store.loadLatestSource(period),
  );
  if (sourceReason) return { kind: "blocked", error: sourceReason };
  const recipients = validateRecipients(rows, input);
  if (typeof recipients === "string") {
    return { kind: "blocked", error: recipients };
  }
  const vatRate = await store.loadVatRate(period);
  if (vatRate === null) {
    return { kind: "blocked", error: "לא נמצא שיעור מע״מ לחודש שנבחר" };
  }
  return calculateAndPersist(rows, recipients, vatRate, approvedBy, store);
}
async function calculateAndPersist(
  rows: readonly ApprovalBillingRow[],
  recipients: Map<string, readonly OwnerRecipient[]>,
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
  return persistApprovalArtifacts(artifacts, recipients, approvedBy, store);
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
  recipients: Map<string, readonly OwnerRecipient[]>,
  approvedBy: string,
  store: ApprovalStore,
): Promise<TransactionResult> {
  const deferred = artifacts.filter(({ calculation }) =>
    isPositive(calculation.discountValue));
  const ledger = deferred.map(({ row, calculation }) => ({
    billingId: row.id,
    franchiseeId: row.franchiseeId,
    amount: calculation.discountValue,
    createdBy: approvedBy,
    note: `דחיית חיוב · ${row.periodMonth}/${row.periodYear}`,
  }));
  await store.insertLedger(ledger);
  const emails = deferred.flatMap(({ row, snapshot, calculation }) =>
    (recipients.get(row.franchiseeId) ?? []).map((recipient) => ({
      billingId: row.id,
      franchiseeId: row.franchiseeId,
      to: recipient.email,
      props: emailProps(
        row,
        recipient,
        calculation,
        snapshot.marketingRateSnapshot,
      ),
    })));
  return {
    kind: "approved",
    billingCount: artifacts.length,
    ledgerEntriesCreated: ledger.length,
    emails,
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
    loadLatestSource: async (period) => {
      const [source] = await database.select({
        id: schema.uploadedFile.id,
        fileName: schema.uploadedFile.originalFileName,
        metadata: schema.uploadedFile.metadata,
      }).from(schema.uploadedFile).where(and(
        eq(
          schema.uploadedFile.periodStartDate,
          `${period.year}-${String(period.month).padStart(2, "0")}-01`,
        ),
        sql`${schema.uploadedFile.metadata}->>'documentType' = ${"franchisee_royalty_revenue"}`,
      )).orderBy(
        desc(schema.uploadedFile.createdAt),
        desc(schema.uploadedFile.id),
      ).limit(1).for("share");
      return source ?? null;
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
function retryRowsQuery(
  database: Pick<ApprovalDatabase, "select">,
  input: FranchiseeBillingRetryInput,
) {
  const period = { year: input.periodYear, month: input.periodMonth };
  return createLockedApprovalRowsQuery(database, period).then((rows) =>
    rows.filter((row) =>
      input.failures.some((failure) => failure.billingId === row.id)));
}
async function loadRetryContext(
  database: ApprovalDatabase,
  input: FranchiseeBillingRetryInput,
): Promise<RetryEmailContext> {
  const billingIds = [...new Set(input.failures.map((item) => item.billingId))];
  const [rows, logs] = await Promise.all([
    retryRowsQuery(database, input),
    database.select({
      entityId: schema.emailLog.entityId,
      toEmail: schema.emailLog.toEmail,
      status: schema.emailLog.status,
      metadata: schema.emailLog.metadata,
    }).from(schema.emailLog).where(and(
      eq(schema.emailLog.entityType, "franchisee_billing"),
      inArray(schema.emailLog.entityId, billingIds),
    )).orderBy(desc(schema.emailLog.createdAt), desc(schema.emailLog.id)),
  ]);
  return { rows, logs };
}

async function deliverEmail(
  message: ApprovalEmailMessage,
): Promise<{ readonly success: boolean; readonly error?: string }> {
  const element = FranchiseeBillingEmail(message.props);
  const [html, text, emailService] = await Promise.all([
    render(element),
    render(element, { plainText: true }),
    import("@/lib/email/service"),
  ]);
  return emailService.sendDirectEmail({
    to: message.to,
    subject: franchiseeBillingEmailSubject(message.props),
    html,
    text,
    entityType: "franchisee_billing",
    entityId: message.billingId,
    metadata: {
      messageKind: "franchisee_billing_approval",
      franchiseeId: message.franchiseeId,
      periodYear: message.props.periodYear,
      periodMonth: message.props.periodMonth,
    },
  });
}

async function defaultOperations(): Promise<FranchiseeBillingApprovalOperations> {
  const { database } = await import("@/db");
  return {
    withTransaction: <T>(work: (store: ApprovalStore) => Promise<T>) =>
      database.transaction(
        (tx) => work(approvalStore(tx)),
        { isolationLevel: "serializable" },
      ),
    loadRetryContext: (input) => loadRetryContext(database, input),
    sendEmail: deliverEmail,
  };
}

function logIsApprovalEmail(log: ApprovalEmailLog): boolean {
  return typeof log.metadata === "object" &&
    log.metadata !== null &&
    "messageKind" in log.metadata &&
    log.metadata.messageKind === "franchisee_billing_approval";
}

function retryMessages(
  input: FranchiseeBillingRetryInput,
  context: RetryEmailContext,
): readonly ApprovalEmailMessage[] | string {
  const rows = new Map(context.rows.map((row) => [row.id, row]));
  const messages: ApprovalEmailMessage[] = [];
  for (const failure of input.failures) {
    const row = rows.get(failure.billingId);
    if (!row || row.status !== "approved" || row.franchiseeId !== failure.franchiseeId) {
      return "שורת החיוב לשליחה החוזרת אינה מאושרת או אינה שייכת לזכיין";
    }
    const recipients = ownerRecipients(row, [failure.email]);
    if (typeof recipients === "string" || !recipients[0]) {
      return typeof recipients === "string" ? recipients : "נמען המייל אינו תקין";
    }
    const latestLog = context.logs.find((log) =>
      log.entityId === row.id &&
      normalizeEmail(log.toEmail) === normalizeEmail(failure.email) &&
      logIsApprovalEmail(log));
    if (!latestLog || latestLog.status !== "failed") {
      return `אין כשל מייל פתוח עבור ${failure.email}`;
    }
    if (
      !row.tiersSnapshot ||
      !row.tierBasisSnapshot ||
      row.marketingRateSnapshot === null ||
      row.vatRateSnapshot === null
    ) {
      return `צילום המצב של ${row.franchiseeName} אינו שלם`;
    }
    const values = calculateCanonicalApproval(row, {
      tiers: row.tiersSnapshot,
      tierBasis: row.tierBasisSnapshot,
      marketingRate: Number(row.marketingRateSnapshot),
      vat: Number(row.vatRateSnapshot),
    });
    messages.push({
      billingId: row.id,
      franchiseeId: row.franchiseeId,
      to: recipients[0].email,
      props: emailProps(
        row,
        recipients[0],
        values,
        row.marketingRateSnapshot,
      ),
    });
  }
  return messages;
}

async function sendEmails(
  messages: readonly ApprovalEmailMessage[],
  operations: FranchiseeBillingApprovalOperations,
): Promise<{
  readonly sent: number;
  readonly failures: readonly FranchiseeBillingEmailFailure[];
}> {
  let sent = 0;
  const failures: FranchiseeBillingEmailFailure[] = [];
  for (const message of messages) {
    try {
      const result = await operations.sendEmail(message);
      if (result.success) {
        sent += 1;
        continue;
      }
      failures.push({
        billingId: message.billingId,
        franchiseeId: message.franchiseeId,
        email: message.to,
        error: result.error ?? "שירות המייל דחה את השליחה",
      });
    } catch (error: unknown) {
      failures.push({
        billingId: message.billingId,
        franchiseeId: message.franchiseeId,
        email: message.to,
        error: error instanceof Error ? error.message : "שגיאת שליחה לא ידועה",
      });
    }
  }
  for (const failure of failures) {
    console.error("[franchisee-billing-approve] Email delivery failed", failure);
  }
  return { sent, failures };
}

function responseData(
  result: TransactionResult,
  sent: number,
  failures: readonly FranchiseeBillingEmailFailure[],
) {
  return {
    approvalCommitted: result.kind === "approved",
    alreadyApproved: result.kind === "already_approved",
    billingsApproved: result.kind === "approved" ? result.billingCount : 0,
    ledgerEntriesCreated:
      result.kind === "approved" ? result.ledgerEntriesCreated : 0,
    emailsSent: sent,
    emailFailures: failures,
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

async function approvalResponse(
  result: TransactionResult,
  operations: FranchiseeBillingApprovalOperations,
  requestId: string,
): Promise<NextResponse> {
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
  const delivery = result.kind === "approved"
    ? await sendEmails(result.emails, operations)
    : { sent: 0, failures: [] };
  const data = responseData(result, delivery.sent, delivery.failures);
  if (delivery.failures.length > 0) {
    return NextResponse.json({
      success: false,
      error: `החיובים אושרו, אך ${delivery.failures.length} הודעות לא נשלחו`,
      data,
      requestId,
    }, { status: 207 });
  }
  return NextResponse.json({ success: true, data, requestId });
}

async function retryResponse(
  input: FranchiseeBillingRetryInput,
  operations: FranchiseeBillingApprovalOperations,
  requestId: string,
): Promise<NextResponse> {
  const messages = retryMessages(
    input,
    await operations.loadRetryContext(input),
  );
  if (typeof messages === "string") {
    return NextResponse.json(
      { success: false, error: messages, requestId },
      { status: 409 },
    );
  }
  const delivery = await sendEmails(messages, operations);
  const data = {
    approvalCommitted: false,
    alreadyApproved: true,
    billingsApproved: 0,
    ledgerEntriesCreated: 0,
    emailsSent: delivery.sent,
    emailFailures: delivery.failures,
  };
  if (delivery.failures.length > 0) {
    return NextResponse.json({
      success: false,
      error: `${delivery.failures.length} הודעות עדיין לא נשלחו`,
      data,
      requestId,
    }, { status: 207 });
  }
  return NextResponse.json({ success: true, data, requestId });
}

/**
 * Approves one billing month atomically, then sends selected owner emails.
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
    if (validation.data.action === "retry_failed") {
      return finish(await retryResponse(validation.data, operations, requestId));
    }
    const approvalInput = validation.data;
    const result = await operations.withTransaction((store) =>
      approveWithinTransaction(approvalInput, authResult.user.id, store));
    return finish(await approvalResponse(result, operations, requestId));
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
