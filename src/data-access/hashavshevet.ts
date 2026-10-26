import { and, asc, count, desc, eq, inArray, isNull, lt, or, sql, type SQL } from "drizzle-orm";
import { database } from "@/db";
import {
  brand,
  franchisee,
  hashavshevetCompany,
  hashavshevetSend,
  hashavshevetSentRow,
  user,
  type HashavshevetCompany,
  type HashavshevetSendStatus,
} from "@/db/schema";
import { apiMoney } from "@/lib/hashavshevet/format";
import type { ActiveLock, ClassifiedRow, CompanyInfo } from "@/lib/hashavshevet/classify";
import { STALE_PENDING_MINUTES, type ExportType } from "@/lib/hashavshevet/types";
import type { HConnectPlugin } from "@/lib/hconnect";

/** Persistence for Hashavshevet sends and row locks (spec §5). Injected into route handlers. */

export type CompanyRecord = CompanyInfo & { fileName: string; nameHe: string };

/** A company as the settings screen shows it. */
export type CompanyRow = CompanyRecord & { compId: number | null };

export interface MappingsOverview {
  brands: Array<{ id: string; code: string; nameHe: string; companyId: string | null }>;
  /** Active franchisees only. */
  franchisees: Array<{ id: string; name: string; brandCode: string; status: string; companyId: string | null }>;
}

export type ResolveOutcome = "approved" | "rejected" | "arrived";

export interface SendSummary {
  id: string;
  exportType: ExportType;
  companyId: string;
  companyName: string;
  targetFileName: string;
  status: HashavshevetSendStatus;
  /** Rows that reached Hashavshevet: excludes rows released as `send_failed`; rejected / unlocked rows still count. */
  rowCount: number;
  /** Sum of the amounts of the same rows as `rowCount`. Reut compares both to the temporary batch. */
  total: number;
  sentAt: Date;
  /** Sender's name; null when the user was deleted. */
  sentBy: string | null;
  resolvedAt: Date | null;
  resolutionNote: string | null;
  /** The export params as sent (jsonb); the sends screen derives the period from them. */
  params: unknown;
}

/** One locked row of a send, with who released it and why (spec §9 detail view). */
export interface SendDetailRow {
  id: string;
  rowKey: string;
  amount: number;
  /** The exact row sent to the API. */
  payload: unknown;
  unlockedAt: Date | null;
  /** Name of the user who released the row; null when released by the system or the user was deleted. */
  unlockedBy: string | null;
  unlockReason: string | null;
}

export interface SendDetail extends SendSummary {
  /** Raw H-Connect response (token excluded); null while pending or when the call never answered. */
  response: unknown;
  rows: SendDetailRow[];
}

export interface FinishSendResult {
  status: "awaiting_approval" | "approved" | "failed" | "unknown";
  failedRowKeys: string[];
  httpStatus?: number;
  response?: unknown;
  latencyMs?: number;
  requestId: string;
}

/** The approved send's export type and its delivered row keys (not released as send_failed). */
export type OnApproved = (exportType: ExportType, deliveredRowKeys: string[]) => Promise<void>;

export interface HashavshevetStore {
  getCompanies(): Promise<Map<string, CompanyRecord>>;
  listCompanies(): Promise<CompanyRow[]>;
  /** `liveFrom` YYYY-MM-DD, or null to deactivate; an omitted key is left unchanged. Null when the company does not exist. */
  updateCompany(
    id: string,
    patch: { liveFrom?: string | null; requiresApproval?: boolean },
    userId: string,
  ): Promise<CompanyRow | null>;
  listMappings(): Promise<MappingsOverview>;
  /** False when the brand / franchisee, or a non-null company, does not exist. */
  setMapping(kind: "brand" | "franchisee", id: string, companyId: string | null): Promise<boolean>;
  getActiveLocks(exportType: ExportType, rowKeys: string[]): Promise<ActiveLock[]>;
  createSendWithLocks(input: {
    exportType: ExportType;
    companyId: string;
    targetFileName: string;
    plugin: HConnectPlugin;
    params: unknown;
    /** Only the rows being sent (status "new"); each one gets locked. */
    rows: ClassifiedRow[];
    sentBy: string;
  }): Promise<{ sendId: string }>;
  finishSend(sendId: string, result: FinishSendResult): Promise<void>;
  /**
   * `onApproved` runs inside the transaction when the send becomes `approved` (ruling R27); if it
   * throws, the approval rolls back and can be retried.
   */
  resolveSend(
    sendId: string,
    outcome: ResolveOutcome,
    note: string | null,
    userId: string,
    onApproved?: OnApproved,
  ): Promise<void>;
  unlockRow(rowId: string, reason: string, userId: string): Promise<void>;
  listSends(filter: { status?: HashavshevetSendStatus; companyId?: string; exportType?: ExportType }): Promise<SendSummary[]>;
  /** Null when the send does not exist. */
  getSendDetail(sendId: string): Promise<SendDetail | null>;
  countAwaitingApproval(): Promise<number>;
}

/** Another active lock already holds one of the rows (parallel send / double click). Map to 409. */
export class LockConflictError extends Error {
  constructor() {
    super("hashavshevet row lock conflict");
    this.name = "LockConflictError";
  }
}

/** The send is not in a status that allows this outcome. `currentStatus` null = send not found. */
export class InvalidTransitionError extends Error {
  constructor(
    readonly outcome: ResolveOutcome,
    readonly currentStatus: HashavshevetSendStatus | null,
  ) {
    super(`cannot resolve send as "${outcome}" from status "${currentStatus ?? "not found"}"`);
    this.name = "InvalidTransitionError";
  }
}

/** The row is missing or already unlocked. */
export class RowNotLockedError extends Error {
  constructor(rowId: string) {
    super(`hashavshevet sent row ${rowId} not found or already unlocked`);
    this.name = "RowNotLockedError";
  }
}

/** `fromStalePending`: also allowed from a `pending` send old enough that its request is surely dead. */
const TRANSITIONS: Record<
  ResolveOutcome,
  { from: HashavshevetSendStatus[]; to: HashavshevetSendStatus; fromStalePending: boolean }
> = {
  approved: { from: ["awaiting_approval"], to: "approved", fromStalePending: false },
  rejected: { from: ["awaiting_approval", "unknown"], to: "rejected", fromStalePending: true },
  arrived: { from: ["unknown"], to: "awaiting_approval", fromStalePending: true },
};

/**
 * Escape hatch (ruling R16): a send still `pending` 15 minutes after sent_at outlived its request
 * (route maxDuration is 300 s) — killed mid-send, or both finishSend calls failed. 15 minutes is far
 * past maxDuration, so a live request can never be resolved underneath.
 */
const STALE_PENDING = and(
  eq(hashavshevetSend.status, "pending"),
  lt(hashavshevetSend.sentAt, sql`now() - interval '${sql.raw(String(STALE_PENDING_MINUTES))} minutes'`),
);

/** Postgres unique_violation, bare or wrapped by Drizzle (`cause`). */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

function toCompanyRow(c: HashavshevetCompany): CompanyRow {
  return {
    id: c.id,
    fileName: c.fileName,
    compId: c.compId,
    nameHe: c.nameHe,
    liveFrom: c.liveFrom,
    requiresApproval: c.requiresApproval,
  };
}

async function getCompanies(): Promise<Map<string, CompanyRecord>> {
  const rows = await database.select().from(hashavshevetCompany);
  return new Map(rows.map((c) => [c.id, toCompanyRow(c)]));
}

async function listCompanies(): Promise<CompanyRow[]> {
  const rows = await database.select().from(hashavshevetCompany).orderBy(asc(hashavshevetCompany.compId));
  return rows.map(toCompanyRow);
}

async function updateCompany(
  id: string,
  patch: Parameters<HashavshevetStore["updateCompany"]>[1],
  userId: string,
): Promise<CompanyRow | null> {
  // Drizzle leaves `undefined` keys out of the SET, so only the fields the caller sent change.
  const [row] = await database
    .update(hashavshevetCompany)
    .set({ liveFrom: patch.liveFrom, requiresApproval: patch.requiresApproval, updatedAt: new Date(), updatedBy: userId })
    .where(eq(hashavshevetCompany.id, id))
    .returning();
  return row ? toCompanyRow(row) : null;
}

async function listMappings(): Promise<MappingsOverview> {
  const [brands, franchisees] = await Promise.all([
    database
      .select({ id: brand.id, code: brand.code, nameHe: brand.nameHe, companyId: brand.hashavshevetCompanyId })
      .from(brand)
      .where(eq(brand.isSystemBrand, false))
      .orderBy(asc(brand.code)),
    database
      .select({
        id: franchisee.id,
        name: franchisee.name,
        brandCode: brand.code,
        status: franchisee.status,
        companyId: franchisee.hashavshevetCompanyId,
      })
      .from(franchisee)
      .innerJoin(brand, eq(franchisee.brandId, brand.id))
      .where(eq(franchisee.status, "active"))
      .orderBy(asc(brand.code), asc(franchisee.name)),
  ]);
  return { brands, franchisees };
}

async function setMapping(kind: "brand" | "franchisee", id: string, companyId: string | null): Promise<boolean> {
  if (companyId !== null) {
    const [company] = await database
      .select({ id: hashavshevetCompany.id })
      .from(hashavshevetCompany)
      .where(eq(hashavshevetCompany.id, companyId));
    if (!company) return false;
  }
  const set = { hashavshevetCompanyId: companyId, updatedAt: new Date() };
  const updated =
    kind === "brand"
      ? await database.update(brand).set(set).where(eq(brand.id, id)).returning({ id: brand.id })
      : await database.update(franchisee).set(set).where(eq(franchisee.id, id)).returning({ id: franchisee.id });
  return updated.length > 0;
}

// ponytail: one IN list; a single export is a few hundred keys, far under pg's 65535-param cap.
async function getActiveLocks(exportType: ExportType, rowKeys: string[]): Promise<ActiveLock[]> {
  if (rowKeys.length === 0) return [];
  const rows = await database
    .select({
      rowKey: hashavshevetSentRow.rowKey,
      companyId: hashavshevetSentRow.companyId,
      amount: hashavshevetSentRow.amount,
      sentAt: hashavshevetSend.sentAt,
      sentBy: hashavshevetSend.sentBy,
      sentByName: user.name,
      sendStatus: hashavshevetSend.status,
    })
    .from(hashavshevetSentRow)
    .innerJoin(hashavshevetSend, eq(hashavshevetSentRow.sendId, hashavshevetSend.id))
    .leftJoin(user, eq(hashavshevetSend.sentBy, user.id))
    .where(
      and(
        eq(hashavshevetSentRow.exportType, exportType),
        isNull(hashavshevetSentRow.unlockedAt),
        inArray(hashavshevetSentRow.rowKey, rowKeys),
      ),
    );
  return rows.map((r) => ({ ...r, amount: Number(r.amount) }));
}

async function createSendWithLocks(input: Parameters<HashavshevetStore["createSendWithLocks"]>[0]) {
  try {
    return await database.transaction(async (tx) => {
      const [send] = await tx
        .insert(hashavshevetSend)
        .values({
          exportType: input.exportType,
          companyId: input.companyId,
          targetFileName: input.targetFileName,
          plugin: input.plugin,
          params: input.params,
          rowCount: input.rows.length,
          status: "pending",
          sentBy: input.sentBy,
        })
        .returning({ id: hashavshevetSend.id });
      if (input.rows.length > 0) {
        await tx.insert(hashavshevetSentRow).values(
          input.rows.map((row) => ({
            sendId: send.id,
            exportType: input.exportType,
            companyId: input.companyId,
            rowKey: row.rowKey,
            amount: apiMoney(row.amount),
            payload: row.apiRow,
          })),
        );
      }
      return { sendId: send.id };
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new LockConflictError();
    throw err;
  }
}

/**
 * Settles a pending send. Only a `pending` send changes: a late or duplicate call (e.g. the
 * route's safety-net finishSend after a failed first one) is a no-op and releases nothing.
 */
async function finishSend(sendId: string, result: FinishSendResult): Promise<void> {
  await database.transaction(async (tx) => {
    const updated = await tx
      .update(hashavshevetSend)
      .set({
        status: result.status,
        httpStatus: result.httpStatus,
        response: result.response,
        latencyMs: result.latencyMs,
        requestId: result.requestId,
      })
      .where(and(eq(hashavshevetSend.id, sendId), eq(hashavshevetSend.status, "pending")))
      .returning({ id: hashavshevetSend.id });
    if (updated.length === 0 || result.failedRowKeys.length === 0) return;
    await tx
      .update(hashavshevetSentRow)
      .set({ unlockedAt: new Date(), unlockReason: "send_failed" })
      .where(
        and(
          eq(hashavshevetSentRow.sendId, sendId),
          inArray(hashavshevetSentRow.rowKey, result.failedRowKeys),
          isNull(hashavshevetSentRow.unlockedAt),
        ),
      );
  });
}

/** Rows of a chunk that failed are released as `send_failed`; they never reached the temporary batch. */
const DELIVERED = sql`${hashavshevetSentRow.unlockReason} IS DISTINCT FROM 'send_failed'`;

async function resolveSend(
  sendId: string,
  outcome: ResolveOutcome,
  note: string | null,
  userId: string,
  onApproved?: OnApproved,
): Promise<void> {
  if (outcome === "rejected" && !note?.trim()) throw new Error("a rejection note is required");
  const { from, to, fromStalePending } = TRANSITIONS[outcome];
  const allowedFrom = inArray(hashavshevetSend.status, from);
  const now = new Date();
  await database.transaction(async (tx) => {
    // Status check and update in one statement: a concurrent resolve cannot slip between them.
    const updated = await tx
      .update(hashavshevetSend)
      .set({ status: to, resolvedBy: userId, resolvedAt: now, resolutionNote: note })
      .where(and(eq(hashavshevetSend.id, sendId), fromStalePending ? or(allowedFrom, STALE_PENDING) : allowedFrom))
      .returning({ id: hashavshevetSend.id, exportType: hashavshevetSend.exportType });
    if (updated.length === 0) {
      const [current] = await tx
        .select({ status: hashavshevetSend.status })
        .from(hashavshevetSend)
        .where(eq(hashavshevetSend.id, sendId));
      throw new InvalidTransitionError(outcome, current?.status ?? null);
    }
    if (to === "approved" && onApproved) {
      const delivered = await tx
        .select({ rowKey: hashavshevetSentRow.rowKey })
        .from(hashavshevetSentRow)
        .where(and(eq(hashavshevetSentRow.sendId, sendId), DELIVERED));
      await onApproved(updated[0].exportType as ExportType, delivered.map((r) => r.rowKey));
    }
    if (outcome !== "rejected") return;
    await tx
      .update(hashavshevetSentRow)
      .set({ unlockedAt: now, unlockedBy: userId, unlockReason: `rejected: ${note}` })
      .where(and(eq(hashavshevetSentRow.sendId, sendId), isNull(hashavshevetSentRow.unlockedAt)));
  });
}

async function unlockRow(rowId: string, reason: string, userId: string): Promise<void> {
  const updated = await database
    .update(hashavshevetSentRow)
    .set({ unlockedAt: new Date(), unlockedBy: userId, unlockReason: reason })
    .where(and(eq(hashavshevetSentRow.id, rowId), isNull(hashavshevetSentRow.unlockedAt)))
    .returning({ id: hashavshevetSentRow.id });
  if (updated.length === 0) throw new RowNotLockedError(rowId);
}

const MAX_SENDS_LISTED = 500; // ponytail: hard cap instead of pagination; add paging if history outgrows it.

async function selectSummaries(where: SQL | undefined, limit: number): Promise<SendSummary[]> {
  const rows = await database
    .select({
      id: hashavshevetSend.id,
      exportType: hashavshevetSend.exportType,
      companyId: hashavshevetSend.companyId,
      companyName: hashavshevetCompany.nameHe,
      targetFileName: hashavshevetSend.targetFileName,
      status: hashavshevetSend.status,
      rowCount: sql<string>`count(${hashavshevetSentRow.id}) FILTER (WHERE ${DELIVERED})`,
      total: sql<string>`coalesce(sum(${hashavshevetSentRow.amount}) FILTER (WHERE ${DELIVERED}), 0)`,
      sentAt: hashavshevetSend.sentAt,
      sentBy: user.name,
      resolvedAt: hashavshevetSend.resolvedAt,
      resolutionNote: hashavshevetSend.resolutionNote,
      params: hashavshevetSend.params,
    })
    .from(hashavshevetSend)
    .innerJoin(hashavshevetCompany, eq(hashavshevetSend.companyId, hashavshevetCompany.id))
    .leftJoin(hashavshevetSentRow, eq(hashavshevetSentRow.sendId, hashavshevetSend.id))
    .leftJoin(user, eq(hashavshevetSend.sentBy, user.id))
    .where(where)
    // Like every other send column selected here, params is not grouped: Postgres allows it (functional dependency on the primary key).
    .groupBy(hashavshevetSend.id, hashavshevetCompany.nameHe, user.name)
    .orderBy(desc(hashavshevetSend.sentAt))
    .limit(limit);
  return rows.map((r) => ({
    ...r,
    exportType: r.exportType as ExportType,
    rowCount: Number(r.rowCount),
    total: Number(r.total),
  }));
}

async function listSends(filter: Parameters<HashavshevetStore["listSends"]>[0]): Promise<SendSummary[]> {
  return selectSummaries(
    and(
      filter.status ? eq(hashavshevetSend.status, filter.status) : undefined,
      filter.companyId ? eq(hashavshevetSend.companyId, filter.companyId) : undefined,
      filter.exportType ? eq(hashavshevetSend.exportType, filter.exportType) : undefined,
    ),
    MAX_SENDS_LISTED,
  );
}

async function getSendDetail(sendId: string): Promise<SendDetail | null> {
  const [summary] = await selectSummaries(eq(hashavshevetSend.id, sendId), 1);
  if (!summary) return null;
  const [[sendRow], rows] = await Promise.all([
    database.select({ response: hashavshevetSend.response }).from(hashavshevetSend).where(eq(hashavshevetSend.id, sendId)),
    database
      .select({
        id: hashavshevetSentRow.id,
        rowKey: hashavshevetSentRow.rowKey,
        amount: hashavshevetSentRow.amount,
        payload: hashavshevetSentRow.payload,
        unlockedAt: hashavshevetSentRow.unlockedAt,
        unlockedBy: user.name,
        unlockReason: hashavshevetSentRow.unlockReason,
      })
      .from(hashavshevetSentRow)
      .leftJoin(user, eq(hashavshevetSentRow.unlockedBy, user.id))
      .where(eq(hashavshevetSentRow.sendId, sendId))
      .orderBy(asc(hashavshevetSentRow.rowKey)),
  ]);
  return { ...summary, response: sendRow?.response ?? null, rows: rows.map((r) => ({ ...r, amount: Number(r.amount) })) };
}

async function countAwaitingApproval(): Promise<number> {
  const [row] = await database
    .select({ n: count() })
    .from(hashavshevetSend)
    .where(eq(hashavshevetSend.status, "awaiting_approval"));
  return row?.n ?? 0;
}

export const drizzleHashavshevetStore: HashavshevetStore = {
  getCompanies,
  listCompanies,
  updateCompany,
  listMappings,
  setMapping,
  getActiveLocks,
  createSendWithLocks,
  finishSend,
  resolveSend,
  unlockRow,
  listSends,
  getSendDetail,
  countAwaitingApproval,
};
