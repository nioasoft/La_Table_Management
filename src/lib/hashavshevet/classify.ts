/** Per-row send status (spec §7). Pure: no DB, no clock. */
import { roundCents } from "./format";
import type { BuiltRow } from "./types";

export type RowStatus = "new" | "sent" | "changed" | "before_live" | "no_company" | "not_live";

export interface ActiveLock {
  rowKey: string;
  companyId: string;
  amount: number;
  sentAt: Date;
  sentBy: string | null;
  /** Sender's display name for the preview; null when the user was deleted. */
  sentByName: string | null;
  sendStatus: string;
}

export interface CompanyInfo {
  id: string;
  /** YYYY-MM-DD; null = company not enabled for sending. */
  liveFrom: string | null;
  requiresApproval: boolean;
}

export type ClassifiedRow = BuiltRow & { status: RowStatus; lock?: ActiveLock };

/**
 * Precedence: no company → company missing/not live → active lock (sent|changed)
 * → period before live date → new. Locks match on rowKey AND companyId.
 */
export function classifyRows(
  rows: BuiltRow[],
  locks: ActiveLock[],
  companies: Map<string, CompanyInfo>,
): ClassifiedRow[] {
  const lockByKey = new Map(locks.map((l) => [`${l.companyId}\u0000${l.rowKey}`, l]));
  return rows.map((row): ClassifiedRow => {
    if (row.companyId === null) return { ...row, status: "no_company" };
    const liveFrom = companies.get(row.companyId)?.liveFrom ?? null;
    if (liveFrom === null) return { ...row, status: "not_live" };
    const lock = lockByKey.get(`${row.companyId}\u0000${row.rowKey}`);
    if (lock) {
      const same = roundCents(lock.amount) === roundCents(row.amount);
      return { ...row, status: same ? "sent" : "changed", lock };
    }
    return { ...row, status: row.periodEnd < liveFrom ? "before_live" : "new" };
  });
}

export function rowsToSend(rows: ClassifiedRow[]): ClassifiedRow[] {
  return rows.filter((r) => r.status === "new");
}

/**
 * Distinct statuses that block a send: only not_live. A row with no company
 * (e.g. דון פדרו — not booked in this Hashavshevet) is skipped and shown as
 * "won't be sent"; it never blocks the rows that do have a company (user
 * decision 2026-10-26).
 */
export function blockingStatuses(rows: ClassifiedRow[]): RowStatus[] {
  const blocking = new Set<RowStatus>();
  for (const r of rows) if (r.status === "not_live") blocking.add(r.status);
  return [...blocking];
}

/** Rows bucketed by companyId, in order of first appearance; null (no company) is its own bucket. */
export function groupByCompanyId<T extends { companyId: string | null }>(rows: T[]): Map<string | null, T[]> {
  const groups = new Map<string | null, T[]>();
  for (const row of rows) {
    const bucket = groups.get(row.companyId);
    if (bucket) bucket.push(row);
    else groups.set(row.companyId, [row]);
  }
  return groups;
}
