/** Pure logic of the Hashavshevet settings and sends screens. No React, no fetch: unit-tested directly. */
import { formatDateAsLocal } from "@/lib/date-utils";
import { sendsCopy, settingsCopy } from "@/lib/hashavshevet/copy";
import type { ExportType, SendStatus } from "@/lib/hashavshevet/types";

export type ResolveOutcome = "approved" | "rejected" | "arrived";

/** Rejecting and opening a row both need a written reason (same minimum as the server schemas). */
const MIN_NOTE_LENGTH = 3;

/** Today as YYYY-MM-DD from local date parts. Never toISOString: it steps back a day in Israel. */
export function todayLocalYmd(now: Date = new Date()): string {
  return formatDateAsLocal(now);
}

/** A stored YYYY-MM-DD as dd/mm/yyyy, by string parts (no Date, so no timezone shift). */
export function formatYmd(ymd: string): string {
  const [y, m, d] = ymd.split("-");
  return `${d}/${m}/${y}`;
}

export const canReject = (note: string): boolean => note.trim().length >= MIN_NOTE_LENGTH;
export const canUnlock = (reason: string): boolean => reason.trim().length >= MIN_NOTE_LENGTH;

export interface Resolvable {
  status: SendStatus;
  /** Pending for over 15 minutes: its request is dead and Reut may settle it. */
  stalePending: boolean;
}

export interface ResolveAction {
  outcome: ResolveOutcome;
  label: string;
  /** Rejecting needs a written note. */
  needsNote: boolean;
}

const APPROVE: ResolveAction = { outcome: "approved", label: sendsCopy.approve, needsNote: false };
const REJECT: ResolveAction = { outcome: "rejected", label: sendsCopy.reject, needsNote: true };
const ARRIVED: ResolveAction = { outcome: "arrived", label: sendsCopy.arrived, needsNote: false };
const NOT_ARRIVED: ResolveAction = { outcome: "rejected", label: sendsCopy.notArrived, needsNote: true };

/** Which buttons a send gets (spec lifecycle box): awaiting approval, or "did it arrive?" for unknown / cut-off sends. */
export function resolveActionsFor(send: Resolvable): ResolveAction[] {
  if (send.status === "awaiting_approval") return [APPROVE, REJECT];
  if (send.status === "unknown" || send.stalePending) return [ARRIVED, NOT_ARRIVED];
  return [];
}

const asRecord = (v: unknown): Record<string, unknown> | null =>
  typeof v === "object" && v !== null ? (v as Record<string, unknown>) : null;

const isYmd = (v: unknown): v is string => typeof v === "string" && /^\d{4}-\d{2}-\d{2}$/.test(v);

function monthYear(month: unknown, year: unknown): string | null {
  if (!Number.isInteger(month) || !Number.isInteger(year)) return null;
  return `${String(month).padStart(2, "0")}/${year}`;
}

function periodOf(exportType: ExportType, p: Record<string, unknown>): string | null {
  switch (exportType) {
    case "supplier_commissions":
      return isYmd(p.startDate) && isYmd(p.endDate) ? `${formatYmd(p.startDate)} – ${formatYmd(p.endDate)}` : null;
    case "royalties":
      return monthYear(p.month, p.year);
    case "franchisee_client_invoices":
    case "journal_entries":
    case "client_commission_invoices":
      return monthYear(p.periodMonth, p.periodYear);
    case "client_commissions":
      return null; // keyed by a reconciliation session, not a period
  }
}

/** The send's period from its stored export params, formatted per export type; a dash when there is none. */
export function periodLabel(exportType: ExportType, params: unknown): string {
  const p = asRecord(params);
  return (p && periodOf(exportType, p)) ?? sendsCopy.noPeriod;
}

export interface CompanyRowView {
  isLive: boolean;
  statusText: string;
  canActivate: boolean;
  canDeactivate: boolean;
  canEditApproval: boolean;
}

/** What one company row shows and which management controls it gets. Admins see it read-only. */
export function companyRowView(company: { liveFrom: string | null }, isSuperUser: boolean): CompanyRowView {
  const isLive = company.liveFrom !== null;
  return {
    isLive,
    statusText: company.liveFrom ? settingsCopy.statusLive(formatYmd(company.liveFrom)) : settingsCopy.statusOff,
    canActivate: isSuperUser && !isLive,
    canDeactivate: isSuperUser && isLive,
    canEditApproval: isSuperUser,
  };
}

/** Radix Select refuses an empty item value, so "no company" travels as this sentinel. */
export const NO_COMPANY = "none";
export const selectValueOf = (companyId: string | null): string => companyId ?? NO_COMPANY;
export const companyIdFromSelect = (value: string): string | null => (value === NO_COMPANY ? null : value);

/** Spec §9: a super user may open a still-locked row only once its send is approved (the server enforces it too). */
export function rowLockView(
  row: { unlockedAt: string | null },
  isSuperUser: boolean,
  sendStatus: SendStatus,
): { locked: boolean; canUnlock: boolean } {
  const locked = row.unlockedAt === null;
  return { locked, canUnlock: isSuperUser && locked && sendStatus === "approved" };
}

/** Why a row was released: system and rejection reasons are stored in English-keyed form, manual ones are free text. */
export function unlockReasonLabel(reason: string | null): string {
  if (!reason) return "";
  if (reason === "send_failed") return sendsCopy.releasedAutomatically;
  if (reason.startsWith("rejected: ")) return sendsCopy.rejectedWithNote(reason.slice("rejected: ".length));
  return reason;
}

export interface Listed extends Resolvable {
  companyId: string;
  exportType: ExportType;
}

/** Sends that need Reut (awaiting approval, unknown, cut off) versus the rest, which is history. Order is kept. */
export function partitionSends<T extends Listed>(sends: T[]): { queue: T[]; history: T[] } {
  const queue: T[] = [];
  const history: T[] = [];
  for (const s of sends) (resolveActionsFor(s).length > 0 ? queue : history).push(s);
  return { queue, history };
}

export const ALL = "all";

export interface HistoryFilter {
  status: SendStatus | typeof ALL;
  companyId: string;
  exportType: ExportType | typeof ALL;
}

export const EMPTY_FILTER: HistoryFilter = { status: ALL, companyId: ALL, exportType: ALL };

/** Statuses that can be in history (the others sit in the queue until resolved). */
export const HISTORY_STATUSES: readonly SendStatus[] = ["pending", "approved", "rejected", "failed"];

export function filterHistory<T extends Listed>(history: T[], filter: HistoryFilter): T[] {
  return history.filter(
    (s) =>
      (filter.status === ALL || s.status === filter.status) &&
      (filter.companyId === ALL || s.companyId === filter.companyId) &&
      (filter.exportType === ALL || s.exportType === filter.exportType),
  );
}

export type StatusBadgeVariant = "success" | "info" | "warning" | "destructive" | "secondary" | "outline";

const BADGE_VARIANTS: Record<SendStatus, StatusBadgeVariant> = {
  approved: "success",
  awaiting_approval: "info",
  unknown: "warning",
  failed: "destructive",
  rejected: "secondary",
  pending: "outline",
};

export const statusBadgeVariant = (status: SendStatus): StatusBadgeVariant => BADGE_VARIANTS[status];

/** The companies that have sends, once each and sorted by name, for the history filter. */
export function companyOptions(sends: Array<{ companyId: string; companyName: string }>): Array<{ id: string; name: string }> {
  const byId = new Map(sends.map((s) => [s.companyId, s.companyName]));
  return [...byId].map(([id, name]) => ({ id, name })).sort((a, b) => a.name.localeCompare(b.name, "he"));
}

/** An ISO timestamp from the API as local "dd/mm/yyyy hh:mm" (built by hand: locale output varies between runtimes). */
export function formatSentAt(iso: string): string {
  const d = new Date(iso);
  const p = (n: number) => String(n).padStart(2, "0");
  return `${p(d.getDate())}/${p(d.getMonth() + 1)}/${d.getFullYear()} ${p(d.getHours())}:${p(d.getMinutes())}`;
}
