import type { CompanyRecord, FinishSendResult, HashavshevetStore } from "@/data-access/hashavshevet";
import { chunkByDocument, HCONNECT_TIMEOUT_MS, type HConnectPlugin, type sendToHashavshevet } from "@/lib/hconnect";
import { groupByCompanyId, type ClassifiedRow } from "./classify";
import { apiErrorMessage, copy } from "./copy";
import { roundCents } from "./format";
import type { ExportDefinition } from "./registry";
import { errorLogFields } from "./route-helpers";
import type { BuiltRow, ExportType, HConnectOutcome } from "./types";

/** Spec §7 send flow, one company at a time: lock rows → send chunks in order → record the outcome. */

export type SendFn = typeof sendToHashavshevet;
type ApiError = Extract<HConnectOutcome, { kind: "api_error" }>;
type SendStatus = FinishSendResult["status"];

export interface RowError {
  rowKey: string;
  message: string;
}

export interface CompanySendResult {
  /** null when the company was not reached in time: nothing was locked or sent ("not_sent"). */
  sendId: string | null;
  companyId: string;
  companyName: string;
  status: SendStatus | "not_sent";
  /** Delivered rows only (released rows excluded): what Reut compares to the temporary batch. */
  rowCount: number;
  total: number;
  /** Requests sent to H-Connect. */
  chunks: number;
  message: string;
  /** Present when H-Connect rejected a request; per-row reasons mapped to rowKeys. */
  errors?: RowError[];
}

export interface CompanyPlan {
  company: CompanyRecord;
  rows: ClassifiedRow[];
  chunks: BuiltRow[][];
}

export interface SendContext {
  store: Pick<HashavshevetStore, "createSendWithLocks" | "finishSend">;
  send: SendFn;
  exportType: ExportType;
  plugin: HConnectPlugin;
  params: unknown;
  sentBy: string;
  requestId: string;
  now: () => number;
  /** Epoch ms by which every started H-Connect request must be able to time out (ruling R16). */
  deadline: number;
  /** The export's bookkeeping for a send that settles `approved` right away (ruling R27). */
  onApproved?: ExportDefinition["onApproved"];
}

interface Settled {
  status: SendStatus;
  failedRowKeys: string[];
  delivered: BuiltRow[];
  /** The rejected request and its rows, when the send stopped on an api_error. */
  rejected?: { outcome: ApiError; rows: BuiltRow[] };
  /** The time budget stopped the send before its remaining chunks (never started, released). */
  outOfTime?: boolean;
}

type Expected = { rowKey: string; amount: number };

const keysOf = (chunks: BuiltRow[][]): string[] => chunks.flat().map((r) => r.rowKey);
const totalOf = (rows: BuiltRow[]): number => roundCents(rows.reduce((sum, r) => sum + r.amount, 0));
/** NaN-safe: a missing timeout constant means "no time", so nothing starts. */
const hasTimeFor = (ctx: SendContext): boolean => ctx.now() + HCONNECT_TIMEOUT_MS <= ctx.deadline;
const signature = (rows: Expected[]): string[] => rows.map((r) => `${r.rowKey}\u0000${roundCents(r.amount)}`).sort();

/** Spec §7: the rows the server would send now must be exactly what the user saw (keys, and amounts to the cent). */
export function matchesExpected(newRows: ClassifiedRow[], expected: Expected[]): boolean {
  const have = signature(newRows);
  const want = signature(expected);
  return have.length === want.length && have.every((v, i) => v === want[i]);
}

/**
 * One plan per company, never mixed: locks are recorded under the send's company. Chunked up front
 * so an oversize document (or missing H-Connect env) fails before anything is locked.
 */
export function planCompanySends(
  rows: ClassifiedRow[],
  companies: Map<string, CompanyRecord>,
  plugin: HConnectPlugin,
): CompanyPlan[] {
  return [...groupByCompanyId(rows)].map(([companyId, companyRows]) => {
    const company = companyId === null ? undefined : companies.get(companyId);
    if (!company) throw new Error(`new rows without a company record: ${companyId}`);
    return { company, rows: companyRows, chunks: chunkByDocument(companyRows, plugin, company.fileName) };
  });
}

/** What the outcomes of the attempted chunks mean for the send and its locks (spec §7, ruling R11). */
export function settle(outcomes: HConnectOutcome[], chunks: BuiltRow[][], requiresApproval: boolean): Settled {
  const attempted = outcomes.length;
  const stop = outcomes[attempted - 1];
  if (stop?.kind === "unknown") {
    // The .dat may have arrived: that chunk stays locked until Reut decides; only unattempted rows go.
    return { status: "unknown", failedRowKeys: keysOf(chunks.slice(attempted)), delivered: chunks.slice(0, attempted).flat() };
  }
  if (stop?.kind === "api_error") {
    const last = attempted - 1;
    return {
      status: last > 0 ? "awaiting_approval" : "failed",
      failedRowKeys: keysOf(chunks.slice(last)),
      delivered: chunks.slice(0, last).flat(),
      rejected: { outcome: stop, rows: chunks[last] },
    };
  }
  // Every attempted chunk was ok; fewer than all means the time budget stopped the rest before they started.
  const delivered = chunks.slice(0, attempted).flat();
  if (attempted === chunks.length) {
    return { status: requiresApproval ? "awaiting_approval" : "approved", failedRowKeys: [], delivered };
  }
  return {
    status: attempted > 0 ? "awaiting_approval" : "failed",
    failedRowKeys: keysOf(chunks.slice(attempted)),
    delivered,
    outOfTime: true,
  };
}

function messageFor(s: Settled, okChunks: number, plugin: HConnectPlugin, companyName: string): string {
  if (s.status === "unknown") return copy.unknownOutcome;
  const count = s.delivered.length;
  const total = totalOf(s.delivered);
  const sent =
    s.status === "approved"
      ? copy.sentApproved(count, total, companyName, okChunks)
      : copy.sentAwaitingApproval(count, total, companyName, okChunks);
  const reason = s.rejected
    ? apiErrorMessage(s.rejected.outcome.code, plugin, companyName)
    : s.outOfTime
      ? copy.sendTimeBudgetExceeded
      : null;
  if (!reason) return sent;
  return count > 0 ? `${sent}. ${reason}` : reason;
}

/** rowErrors indexes are relative to the rejected request. */
function rowErrorsOf({ outcome, rows }: NonNullable<Settled["rejected"]>): RowError[] {
  return Object.entries(outcome.rowErrors).flatMap(([index, detail]) => {
    const row = rows[Number(index)];
    return row ? [{ rowKey: row.rowKey, message: copy.rowRejected(detail) }] : [];
  });
}

/** httpStatus / response / latency of the last attempted request, for the audit row. */
function auditOf(outcome: HConnectOutcome | undefined): Pick<FinishSendResult, "httpStatus" | "response" | "latencyMs"> {
  if (!outcome) return {};
  if (outcome.kind === "unknown") return { response: { message: outcome.message } };
  return { httpStatus: outcome.httpStatus, response: outcome.body, latencyMs: outcome.kind === "ok" ? outcome.latencyMs : undefined };
}

function logCompanySend(ctx: SendContext, companyId: string, sendId: string | null, status: string, rows: number, chunks: number): void {
  console.log(
    JSON.stringify({ event: "hashavshevet.company_send", requestId: ctx.requestId, exportType: ctx.exportType, companyId, sendId, status, rows, chunks }),
  );
}

/** A company the time budget did not reach: never locked, nothing sent. */
function notSent(ctx: SendContext, { company, rows }: CompanyPlan): CompanySendResult {
  logCompanySend(ctx, company.id, null, "not_sent", rows.length, 0);
  return {
    sendId: null,
    companyId: company.id,
    companyName: company.nameHe,
    status: "not_sent",
    rowCount: 0,
    total: 0,
    chunks: 0,
    message: copy.sendTimeBudgetExceeded,
  };
}

/**
 * Ruling R27: a send that settled `approved` runs its export's bookkeeping now. The rows did go
 * out, so a failure is logged and reported in the result, never thrown. Returns the warning or null.
 */
async function runOnApproved(ctx: SendContext, sendId: string, s: Settled): Promise<string | null> {
  if (s.status !== "approved" || !ctx.onApproved) return null;
  try {
    await ctx.onApproved(sendId, s.delivered.map((r) => r.rowKey));
    return null;
  } catch (err) {
    console.error(JSON.stringify({ event: "hashavshevet.on_approved_failed", requestId: ctx.requestId, sendId, ...errorLogFields(err) }));
    return copy.approvedBookkeepingFailed;
  }
}

function toResult(
  sendId: string,
  plan: CompanyPlan,
  s: Settled,
  outcomes: HConnectOutcome[],
  plugin: HConnectPlugin,
  warning: string | null,
): CompanySendResult {
  const { company } = plan;
  const okChunks = outcomes.filter((o) => o.kind === "ok").length;
  const message = messageFor(s, okChunks, plugin, company.nameHe);
  return {
    sendId,
    companyId: company.id,
    companyName: company.nameHe,
    status: s.status,
    rowCount: s.delivered.length,
    total: totalOf(s.delivered),
    chunks: outcomes.length,
    message: warning ? `${message}. ${warning}` : message,
    ...(s.rejected && { errors: rowErrorsOf(s.rejected) }),
  };
}

/**
 * Locks the company's rows, sends its chunks sequentially (stopping at the first non-ok one, or
 * before a chunk the time budget can't cover) and records the outcome. Throws LockConflictError
 * (nothing sent) when another send holds a row.
 */
export async function sendCompany(ctx: SendContext, plan: CompanyPlan): Promise<CompanySendResult> {
  if (!hasTimeFor(ctx)) return notSent(ctx, plan);
  const { company, rows, chunks } = plan;
  const { sendId } = await ctx.store.createSendWithLocks({
    exportType: ctx.exportType,
    companyId: company.id,
    targetFileName: company.fileName,
    plugin: ctx.plugin,
    params: ctx.params,
    rows,
    sentBy: ctx.sentBy,
  });
  const outcomes: HConnectOutcome[] = [];
  let started = 0;
  try {
    for (const chunk of chunks) {
      if (!hasTimeFor(ctx)) break; // not started = unattempted: released below
      started++;
      const outcome = await ctx.send(ctx.plugin, company.fileName, chunk.map((r) => r.apiRow));
      outcomes.push(outcome);
      if (outcome.kind !== "ok") break;
    }
    const settled = settle(outcomes, chunks, company.requiresApproval);
    const { status, failedRowKeys } = settled;
    await ctx.store.finishSend(sendId, { status, failedRowKeys, ...auditOf(outcomes[outcomes.length - 1]), requestId: ctx.requestId });
    logCompanySend(ctx, company.id, sendId, status, rows.length, outcomes.length);
    return toResult(sendId, plan, settled, outcomes, ctx.plugin, await runOnApproved(ctx, sendId, settled));
  } catch (err) {
    // Never leave a send pending. A chunk whose request started may have arrived, so it stays locked.
    const failedRowKeys = keysOf(chunks.slice(started));
    await ctx.store
      .finishSend(sendId, { status: "unknown", failedRowKeys, requestId: ctx.requestId })
      .catch((e: unknown) =>
        console.error(JSON.stringify({ event: "hashavshevet.finish_send_failed", requestId: ctx.requestId, sendId, error: e instanceof Error ? e.message : String(e) })),
      );
    throw err;
  }
}
