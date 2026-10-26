/** Pure logic of the send-to-Hashavshevet preview dialog. No React, no fetch: unit-tested directly. */
import type { PreviewData, PreviewGroup, PreviewRow } from "@/app/api/hashavshevet/preview/route";
import type { SendData } from "@/app/api/hashavshevet/send/route";
import type { RowStatus } from "@/lib/hashavshevet/classify";
import { copy, formatShekel, previewCopy, sendStatusLabels } from "@/lib/hashavshevet/copy";
import { roundCents } from "@/lib/hashavshevet/format";
import type { CompanySendResult } from "@/lib/hashavshevet/send-flow";

/** The preview as the browser receives it: JSON turns the lock's `sentAt` Date into an ISO string. */
export type PreviewLock = Omit<NonNullable<PreviewRow["lock"]>, "sentAt"> & { sentAt: string };
export type ClientRow = Omit<PreviewRow, "lock"> & { lock?: PreviewLock };
export type ClientGroup = Omit<PreviewGroup, "rows"> & { rows: ClientRow[] };
export type ClientPreview = Omit<PreviewData, "groups"> & { groups: ClientGroup[] };

export type Tone = "success" | "muted" | "warning" | "dark" | "danger";
export type DialogView = "loading" | "error" | "empty" | "ready" | "result";

/** A failed API call, as the query layer reports it (409/422 may carry sends that did go out). */
export interface SendFailure {
  status: number;
  message: string;
  sends?: CompanySendResult[];
  /** False when no JSON answer came back (network drop, or an edge 502/504 page). */
  answered?: boolean;
}

/**
 * M9: a send that got no JSON answer (network drop, 5xx from the edge) may still have locked and
 * sent rows on the server, so "check the connection and retry" would invite a duplicate.
 */
function failureMessage(error: SendFailure): string {
  const noAnswer = error.answered === false && (error.status === 0 || error.status >= 500);
  return noAnswer ? previewCopy.sendOutcomeUnknown : error.message;
}

export interface ExpectedRow {
  rowKey: string;
  amount: number;
  companyId: string;
}

const rowsOf = (data: ClientPreview): ClientRow[] => data.groups.flatMap((g) => g.rows);

/**
 * What the user is about to send, exactly: the server compares it to its own rebuild (409 on drift).
 * A new row always has a company (classify); one without could only fail the server's comparison.
 */
export function buildExpected(data: ClientPreview): ExpectedRow[] {
  return rowsOf(data).flatMap((r) =>
    r.status === "new" && r.companyId ? [{ rowKey: r.rowKey, amount: r.amount, companyId: r.companyId }] : [],
  );
}

export function groupTotals(data: ClientPreview): { newCount: number; newTotal: number } {
  return {
    newCount: buildExpected(data).length,
    newTotal: roundCents(data.groups.reduce((sum, g) => sum + g.totalNew, 0)),
  };
}

export function blockingMessages(data: ClientPreview): string[] {
  const byStatus: Partial<Record<RowStatus, string>> = {
    no_company: copy.noCompany,
    not_live: previewCopy.someCompaniesNotLive,
  };
  const statusLines = data.blockingStatuses.flatMap((s) => byStatus[s] ?? []);
  return [...data.blockingErrors, ...statusLines];
}

export function canSend(data: ClientPreview): { ok: boolean; reason: string | null } {
  if (data.blockingErrors.length > 0 || data.blockingStatuses.length > 0) {
    return { ok: false, reason: copy.sendBlocked };
  }
  if (groupTotals(data).newCount === 0) return { ok: false, reason: previewCopy.nothingToSend };
  return { ok: true, reason: null };
}

const STATUS_TONE: Record<RowStatus, Tone> = {
  new: "success",
  sent: "muted",
  changed: "warning",
  before_live: "dark",
  no_company: "dark",
  not_live: "dark",
};

export function statusBadge(status: RowStatus): { label: string; tone: Tone } {
  return { label: previewCopy.rowStatus[status], tone: STATUS_TONE[status] };
}

/** "1.10.2026, 00:30" in Israel time, whatever the viewer's own time zone is. */
function formatWhen(iso: string): string {
  return new Date(iso).toLocaleString("he-IL", {
    timeZone: "Asia/Jerusalem",
    day: "numeric",
    month: "numeric",
    year: "numeric",
    hour: "2-digit",
    minute: "2-digit",
    hour12: false,
  });
}

export function describeLock(lock: PreviewLock): string {
  return previewCopy.sentBy(formatWhen(lock.sentAt), lock.sentByName ?? previewCopy.unknownSender);
}

/** The reason line shown under a row's status badge; null when the badge says it all. */
export function statusDetail(row: ClientRow, group: ClientGroup): string | null {
  switch (row.status) {
    case "sent":
      return row.lock ? describeLock(row.lock) : null;
    case "changed":
      return row.lock ? previewCopy.changedAmount(formatShekel(row.lock.amount), formatShekel(row.amount)) : null;
    case "before_live":
      return copy.beforeLive;
    case "no_company":
      return copy.noCompany;
    case "not_live":
      return copy.notLive(group.companyName ?? previewCopy.unknownCompany);
    case "new":
      return null;
  }
}

/** A human label for a row key in an error list: the first display values, else the raw key. */
export function describeRow(data: ClientPreview | undefined, rowKey: string): string {
  const found = data && rowsOf(data).find((r) => r.rowKey === rowKey);
  if (!found) return rowKey;
  return Object.values(found.display).slice(0, 3).join(" · ") || rowKey;
}

/** Table headers of a group: the Excel column names the builder put in `display`, in first-seen order. */
export function displayColumns(rows: ClientRow[]): string[] {
  return [...new Set(rows.flatMap((r) => Object.keys(r.display)))];
}

export interface CompanyResultView {
  companyName: string;
  statusLabel: string;
  tone: Tone;
  message: string;
  rowErrors: { rowKey: string; message: string }[];
}

const SEND_TONE: Record<CompanySendResult["status"], Tone> = {
  awaiting_approval: "success",
  approved: "success",
  failed: "danger",
  unknown: "warning",
  not_sent: "danger",
};

export function sendResultMessages(sends: CompanySendResult[]): CompanyResultView[] {
  return sends.map((s) => ({
    companyName: s.companyName,
    statusLabel: s.status === "not_sent" ? previewCopy.notSent : sendStatusLabels[s.status],
    tone: SEND_TONE[s.status],
    message: s.status === "unknown" ? copy.unknownOutcome : s.message,
    rowErrors: s.errors ?? [],
  }));
}

/** 409 (data changed / concurrent send) and 422 (now blocked) mean the preview is stale: refresh it. */
export function sendOutcome(
  data: SendData | undefined,
  error: SendFailure | null | undefined,
): { sends: CompanySendResult[]; errorMessage: string | null; canRefresh: boolean } {
  return {
    sends: data?.sends ?? error?.sends ?? [],
    errorMessage: error ? failureMessage(error) : null,
    canRefresh: error?.status === 409 || error?.status === 422,
  };
}

export function resolveView(state: {
  previewPending: boolean;
  previewFailed: boolean;
  data: ClientPreview | undefined;
  hasSends: boolean;
}): DialogView {
  const { previewPending, previewFailed, data, hasSends } = state;
  if (previewPending) return "loading";
  if (previewFailed) return "error";
  if (hasSends) return "result";
  if (!data) return "loading";
  const empty = rowsOf(data).length === 0 && data.blockingErrors.length === 0;
  return empty ? "empty" : "ready";
}
