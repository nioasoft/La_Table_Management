/**
 * Which BKMV file owns each month of the franchisee year archive
 * (franchisee_bkmv_year). The archive is whole-month last-write-wins, so every
 * writer must agree on one rule: walking live (non-rejected) files oldest →
 * newest, a newer file takes a month unless its version of the month is a
 * sliver of the current owner's — a stray, not a newer report.
 *
 * Why strays: exports carry documents dated outside the reported period (owner
 * current accounts carried into the new books, forward-dated cheques, typos).
 * On 2026-10-18 a קינג קונג רעננה 2026 file held ONE transaction in Sep 2025,
 * and that stray replaced the real month: ₪4,255,888 → ₪3,835. A whole-year
 * filter is not the answer — ויני חדרה's bookkeeper exports Apr 2025–Oct 2026
 * in one file whose 2025 is the most complete version there is.
 *
 * Pure — the DB side lives in src/data-access/bkmv-archive-ownership.ts.
 */
import type { MonthlyBreakdown, MonthlyBreakdownEntry } from './types';
import { trustedSupplierId } from './monthly-breakdown';

/**
 * A newer file's month replaces the owner's only with at least this share of
 * the owner's transactions. Strays seen on prod: 1 vs 77, 2 vs 109, ~25 vs 75+
 * (all ≤ 33%); real re-exports and late postings run ~100%+.
 * ponytail: one global ratio — make it per-franchisee if a bookkeeper's
 * corrections ever drop half a month.
 */
export const STRAY_MONTH_RATIO = 0.5;

const MONTH_KEY = /^\d{4}-\d{2}$/;

export interface ArchiveSourceFile {
  id: string;
  createdAt: Date;
  monthlyBreakdown: MonthlyBreakdown;
  supplierMatches: Array<{
    bkmvName: string;
    matchedSupplierId: string | null;
    confidence: number;
    matchType: string;
  }>;
}

/** What ownership needs from a file: month → transaction count. */
export interface ArchiveFileMonths {
  id: string;
  createdAt: Date;
  monthTxns: Record<string, number>;
}

/** month → transaction count, YYYY-MM keys only. */
export function monthTxnCounts(breakdown: MonthlyBreakdown): Record<string, number> {
  return Object.fromEntries(
    Object.entries(breakdown)
      .filter(([month]) => MONTH_KEY.test(month))
      .map(([month, entries]) => [month, entries.reduce((sum, e) => sum + e.transactionCount, 0)])
  );
}

/** month → id of the file that owns it. Pass live files only. */
export function archiveMonthOwners(files: ArchiveFileMonths[]): Map<string, string> {
  const ordered = [...files].sort(
    (a, b) => a.createdAt.getTime() - b.createdAt.getTime() || a.id.localeCompare(b.id)
  );
  const owners = new Map<string, { id: string; txns: number }>();
  for (const file of ordered) {
    for (const [month, txns] of Object.entries(file.monthTxns)) {
      if (!MONTH_KEY.test(month)) continue;
      const current = owners.get(month);
      if (!current || txns >= current.txns * STRAY_MONTH_RATIO) {
        owners.set(month, { id: file.id, txns });
      }
    }
  }
  return new Map([...owners].map(([month, owner]) => [month, owner.id]));
}

/**
 * Re-derive each entry's supplierId from the file's matches through
 * trustedSupplierId — a fuzzy suggestion never links. Names absent from the
 * matches keep their stored id.
 */
export function withTrustedSupplierIds(
  breakdown: MonthlyBreakdown,
  supplierMatches: ArchiveSourceFile['supplierMatches']
): MonthlyBreakdown {
  const ids = new Map(supplierMatches.map((m) => [m.bkmvName, trustedSupplierId(m)]));
  return Object.fromEntries(
    Object.entries(breakdown).map(([month, entries]) => [
      month,
      entries.map((entry) => ({
        ...entry,
        supplierId: ids.has(entry.supplierName)
          ? ids.get(entry.supplierName) ?? null
          : entry.supplierId,
      })),
    ])
  );
}

/**
 * What the archive should hold for `months`, given the franchisee's live
 * files: the owner's entries (trusted links only), or null when no live file
 * has the month — it must leave the archive.
 */
export function canonicalArchiveMonths(
  liveFiles: ArchiveSourceFile[],
  months: string[]
): Record<string, MonthlyBreakdownEntry[] | null> {
  const owners = archiveMonthOwners(
    liveFiles.map((f) => ({ id: f.id, createdAt: f.createdAt, monthTxns: monthTxnCounts(f.monthlyBreakdown) }))
  );
  const byId = new Map(liveFiles.map((f) => [f.id, f]));
  const result: Record<string, MonthlyBreakdownEntry[] | null> = {};
  for (const month of months) {
    const owner = byId.get(owners.get(month) ?? '');
    result[month] = owner
      ? withTrustedSupplierIds({ [month]: owner.monthlyBreakdown[month] }, owner.supplierMatches)[month]
      : null;
  }
  return result;
}
