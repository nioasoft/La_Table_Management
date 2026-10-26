import type { CompanyRecord, FinishSendResult, HashavshevetStore } from "@/data-access/hashavshevet";
import { chunkByDocument, type HConnectPlugin, type sendToHashavshevet } from "@/lib/hconnect";
import { groupByCompanyId, type ClassifiedRow } from "./classify";
import { apiErrorMessage, copy } from "./copy";
import { roundCents } from "./format";
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
  sendId: string;
  companyId: string;
  companyName: string;
  status: SendStatus;
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
}

interface Settled {
  status: SendStatus;
  failedRowKeys: string[];
  delivered: BuiltRow[];
  /** The rejected request and its rows, when the send stopped on an api_error. */
  rejected?: { outcome: ApiError; rows: BuiltRow[] };
}

type Expected = { rowKey: string; amount: number };

const keysOf = (chunks: BuiltRow[][]): string[] => chunks.flat().map((r) => r.rowKey);
const totalOf = (rows: BuiltRow[]): number => roundCents(rows.reduce((sum, r) => sum + r.amount, 0));
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
  const last = outcomes.length - 1;
  const stop = outcomes[last];
  // Sending stops at the first non-ok chunk, so an ok last outcome means every chunk went through.
  if (!stop || stop.kind === "ok") {
    return { status: requiresApproval ? "awaiting_approval" : "approved", failedRowKeys: [], delivered: chunks.flat() };
  }
  if (stop.kind === "unknown") {
    // The .dat may have arrived: that chunk stays locked until Reut decides; only unattempted rows go.
    return { status: "unknown", failedRowKeys: keysOf(chunks.slice(last + 1)), delivered: chunks.slice(0, last + 1).flat() };
  }
  return {
    status: last > 0 ? "awaiting_approval" : "failed",
    failedRowKeys: keysOf(chunks.slice(last)),
    delivered: chunks.slice(0, last).flat(),
    rejected: { outcome: stop, rows: chunks[last] },
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
  if (!s.rejected) return sent;
  const rejected = apiErrorMessage(s.rejected.outcome.code, plugin, companyName);
  return count > 0 ? `${sent}. ${rejected}` : rejected;
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

function toResult(sendId: string, plan: CompanyPlan, s: Settled, outcomes: HConnectOutcome[], plugin: HConnectPlugin): CompanySendResult {
  const { company } = plan;
  const okChunks = outcomes.filter((o) => o.kind === "ok").length;
  return {
    sendId,
    companyId: company.id,
    companyName: company.nameHe,
    status: s.status,
    rowCount: s.delivered.length,
    total: totalOf(s.delivered),
    chunks: outcomes.length,
    message: messageFor(s, okChunks, plugin, company.nameHe),
    ...(s.rejected && { errors: rowErrorsOf(s.rejected) }),
  };
}

/**
 * Locks the company's rows, sends its chunks sequentially (stopping at the first non-ok one) and
 * records the outcome. Throws LockConflictError (nothing sent) when another send holds a row.
 */
export async function sendCompany(ctx: SendContext, plan: CompanyPlan): Promise<CompanySendResult> {
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
      started++;
      const outcome = await ctx.send(ctx.plugin, company.fileName, chunk.map((r) => r.apiRow));
      outcomes.push(outcome);
      if (outcome.kind !== "ok") break;
    }
    const settled = settle(outcomes, chunks, company.requiresApproval);
    const { status, failedRowKeys } = settled;
    await ctx.store.finishSend(sendId, { status, failedRowKeys, ...auditOf(outcomes[outcomes.length - 1]), requestId: ctx.requestId });
    console.log(
      JSON.stringify({ event: "hashavshevet.company_send", requestId: ctx.requestId, exportType: ctx.exportType, companyId: company.id, sendId, status, rows: rows.length, chunks: outcomes.length }),
    );
    return toResult(sendId, plan, settled, outcomes, ctx.plugin);
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
