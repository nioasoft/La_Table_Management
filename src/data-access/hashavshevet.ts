import { and, count, desc, eq, inArray, isNull, sql } from "drizzle-orm";
import { database } from "@/db";
import {
  hashavshevetCompany,
  hashavshevetSend,
  hashavshevetSentRow,
  user,
  type HashavshevetSendStatus,
} from "@/db/schema";
import { apiMoney } from "@/lib/hashavshevet/format";
import type { ActiveLock, ClassifiedRow, CompanyInfo } from "@/lib/hashavshevet/classify";
import type { ExportType } from "@/lib/hashavshevet/types";
import type { HConnectPlugin } from "@/lib/hconnect";

/** Persistence for Hashavshevet sends and row locks (spec §5). Injected into route handlers. */

export type CompanyRecord = CompanyInfo & { fileName: string; nameHe: string };

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
}

export interface FinishSendResult {
  status: "awaiting_approval" | "approved" | "failed" | "unknown";
  failedRowKeys: string[];
  httpStatus?: number;
  response?: unknown;
  latencyMs?: number;
  requestId: string;
}

export interface HashavshevetStore {
  getCompanies(): Promise<Map<string, CompanyRecord>>;
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
  resolveSend(sendId: string, outcome: ResolveOutcome, note: string | null, userId: string): Promise<void>;
  unlockRow(rowId: string, reason: string, userId: string): Promise<void>;
  listSends(filter: { status?: HashavshevetSendStatus; companyId?: string; exportType?: ExportType }): Promise<SendSummary[]>;
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

const TRANSITIONS: Record<ResolveOutcome, { from: HashavshevetSendStatus[]; to: HashavshevetSendStatus }> = {
  approved: { from: ["awaiting_approval"], to: "approved" },
  rejected: { from: ["awaiting_approval", "unknown"], to: "rejected" },
  arrived: { from: ["unknown"], to: "awaiting_approval" },
};

/** Postgres unique_violation, bare or wrapped by Drizzle (`cause`). */
export function isUniqueViolation(err: unknown): boolean {
  const e = err as { code?: string; cause?: { code?: string } } | null;
  return e?.code === "23505" || e?.cause?.code === "23505";
}

async function getCompanies(): Promise<Map<string, CompanyRecord>> {
  const rows = await database.select().from(hashavshevetCompany);
  return new Map(
    rows.map((c) => [
      c.id,
      { id: c.id, fileName: c.fileName, nameHe: c.nameHe, liveFrom: c.liveFrom, requiresApproval: c.requiresApproval },
    ]),
  );
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
      sendStatus: hashavshevetSend.status,
    })
    .from(hashavshevetSentRow)
    .innerJoin(hashavshevetSend, eq(hashavshevetSentRow.sendId, hashavshevetSend.id))
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

async function finishSend(sendId: string, result: FinishSendResult): Promise<void> {
  await database.transaction(async (tx) => {
    await tx
      .update(hashavshevetSend)
      .set({
        status: result.status,
        httpStatus: result.httpStatus,
        response: result.response,
        latencyMs: result.latencyMs,
        requestId: result.requestId,
      })
      .where(eq(hashavshevetSend.id, sendId));
    if (result.failedRowKeys.length === 0) return;
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

async function resolveSend(
  sendId: string,
  outcome: ResolveOutcome,
  note: string | null,
  userId: string,
): Promise<void> {
  if (outcome === "rejected" && !note?.trim()) throw new Error("a rejection note is required");
  const { from, to } = TRANSITIONS[outcome];
  const now = new Date();
  await database.transaction(async (tx) => {
    // Status check and update in one statement: a concurrent resolve cannot slip between them.
    const updated = await tx
      .update(hashavshevetSend)
      .set({ status: to, resolvedBy: userId, resolvedAt: now, resolutionNote: note })
      .where(and(eq(hashavshevetSend.id, sendId), inArray(hashavshevetSend.status, from)))
      .returning({ id: hashavshevetSend.id });
    if (updated.length === 0) {
      const [current] = await tx
        .select({ status: hashavshevetSend.status })
        .from(hashavshevetSend)
        .where(eq(hashavshevetSend.id, sendId));
      throw new InvalidTransitionError(outcome, current?.status ?? null);
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

/** Rows of a chunk that failed are released as `send_failed`; they never reached the temporary batch. */
const DELIVERED = sql`${hashavshevetSentRow.unlockReason} IS DISTINCT FROM 'send_failed'`;

const MAX_SENDS_LISTED = 500; // ponytail: hard cap instead of pagination; add paging if history outgrows it.

async function listSends(filter: Parameters<HashavshevetStore["listSends"]>[0]): Promise<SendSummary[]> {
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
    })
    .from(hashavshevetSend)
    .innerJoin(hashavshevetCompany, eq(hashavshevetSend.companyId, hashavshevetCompany.id))
    .leftJoin(hashavshevetSentRow, eq(hashavshevetSentRow.sendId, hashavshevetSend.id))
    .leftJoin(user, eq(hashavshevetSend.sentBy, user.id))
    .where(
      and(
        filter.status ? eq(hashavshevetSend.status, filter.status) : undefined,
        filter.companyId ? eq(hashavshevetSend.companyId, filter.companyId) : undefined,
        filter.exportType ? eq(hashavshevetSend.exportType, filter.exportType) : undefined,
      ),
    )
    .groupBy(hashavshevetSend.id, hashavshevetCompany.nameHe, user.name)
    .orderBy(desc(hashavshevetSend.sentAt))
    .limit(MAX_SENDS_LISTED);
  return rows.map((r) => ({
    ...r,
    exportType: r.exportType as ExportType,
    rowCount: Number(r.rowCount),
    total: Number(r.total),
  }));
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
  getActiveLocks,
  createSendWithLocks,
  finishSend,
  resolveSend,
  unlockRow,
  listSends,
  countAwaitingApproval,
};
