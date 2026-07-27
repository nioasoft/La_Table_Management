import type { BkmvTransaction, MonthlyBreakdown, MonthlyBreakdownEntry } from './types';
import { SUPPLIER_SKIP_PATTERNS } from './constants';
import { formatYearMonth } from './formatters';

/**
 * Build monthly breakdown from transactions
 * Groups credit transactions by month and supplier name
 */
export function buildMonthlyBreakdown(
  transactions: BkmvTransaction[],
  supplierIdMap?: Map<string, string | null>
): MonthlyBreakdown {
  const breakdown: Record<string, Map<string, { amount: number; count: number }>> = {};

  for (const tx of transactions) {
    if (tx.side !== 'credit' || tx.amount === 0) {
      continue;
    }

    const counterparty = tx.counterpartyName.toLowerCase();
    if (SUPPLIER_SKIP_PATTERNS.some(pattern => counterparty.includes(pattern.toLowerCase()))) {
      continue;
    }

    const supplierKey = tx.counterpartyName.trim();
    if (!supplierKey) continue;

    const monthKey = formatYearMonth(tx.documentDate);

    if (!breakdown[monthKey]) {
      breakdown[monthKey] = new Map();
    }

    const current = breakdown[monthKey].get(supplierKey);
    if (current) {
      current.amount += tx.amount;
      current.count++;
    } else {
      breakdown[monthKey].set(supplierKey, { amount: tx.amount, count: 1 });
    }
  }

  const result: MonthlyBreakdown = {};

  for (const [month, suppliers] of Object.entries(breakdown)) {
    result[month] = [];
    for (const [supplierName, data] of suppliers.entries()) {
      result[month].push({
        supplierId: supplierIdMap?.get(supplierName) ?? null,
        supplierName,
        amount: data.amount,
        transactionCount: data.count,
      });
    }
    result[month].sort((a, b) => b.amount - a.amount);
  }

  return result;
}

/**
 * Get amount for a specific supplier in a specific period from monthly breakdown
 */
export function getAmountForPeriod(
  monthlyBreakdown: MonthlyBreakdown | undefined,
  supplierId: string,
  periodStart: string,
  periodEnd: string
): number | null {
  if (!monthlyBreakdown) return null;

  let total = 0;
  let hasData = false;

  const startMonth = periodStart.slice(0, 7);
  const endMonth = periodEnd.slice(0, 7);

  for (const [month, suppliers] of Object.entries(monthlyBreakdown)) {
    if (month >= startMonth && month <= endMonth) {
      const matches = suppliers.filter(s => s.supplierId === supplierId);
      for (const match of matches) {
        total += match.amount;
        hasData = true;
      }
    }
  }

  return hasData ? total : null;
}

/**
 * Merge monthly breakdown from a new file into existing breakdown
 */
export function mergeMonthlyBreakdown(
  existing: MonthlyBreakdown | undefined,
  newData: MonthlyBreakdown
): MonthlyBreakdown {
  if (!existing) {
    return { ...newData };
  }

  const result = { ...existing };

  for (const [month, suppliers] of Object.entries(newData)) {
    result[month] = suppliers;
  }

  return result;
}

/**
 * Canonical signature of a month's entries — order-independent, since
 * buildMonthlyBreakdown sorts by amount and that order is not stable across files.
 */
function monthSignature(entries: MonthlyBreakdownEntry[]): string {
  return entries
    .map(
      (e) =>
        `${e.supplierId ?? ""}|${e.supplierName}|${e.amount}|${e.transactionCount}`
    )
    .sort()
    .join("\n");
}

/**
 * Month keys in `incoming` whose entries differ from `existing` (added or changed).
 *
 * מבנה אחיד files are cumulative from January, so most months in a new upload
 * repeat data already stored. Callers use this to react only to real changes
 * (e.g. flagging reconciliation sessions stale) instead of to the file's span.
 *
 * supplierId is part of the comparison on purpose: it flips from null to an id
 * when an alias is added, and getAmountForPeriod filters by it — so that IS a
 * change to the franchisee's amounts.
 */
export function changedMonths(
  existing: MonthlyBreakdown | undefined,
  incoming: MonthlyBreakdown
): string[] {
  return Object.entries(incoming)
    .filter(([month, entries]) => {
      const before = existing?.[month];
      return !before || monthSignature(before) !== monthSignature(entries);
    })
    .map(([month]) => month)
    .sort();
}

/**
 * Collapse a sorted list of "YYYY-MM" keys into [firstMonth, lastMonth] runs of
 * consecutive months. ["2026-01","2026-04","2026-05"] → [[01,01],[04,05]].
 * Lets callers act on gappy month sets without dragging the gap along.
 */
export function groupIntoConsecutiveRuns(
  months: string[]
): Array<[string, string]> {
  const monthIndex = (m: string) => {
    const [y, mm] = m.split("-").map(Number);
    return y * 12 + mm;
  };

  const runs: Array<[string, string]> = [];
  for (const month of months) {
    const last = runs[runs.length - 1];
    if (last && monthIndex(month) === monthIndex(last[1]) + 1) {
      last[1] = month;
    } else {
      runs.push([month, month]);
    }
  }
  return runs;
}

/**
 * Split a MonthlyBreakdown by year
 */
export function groupMonthlyBreakdownByYear(
  breakdown: MonthlyBreakdown
): Map<number, MonthlyBreakdown> {
  const byYear = new Map<number, MonthlyBreakdown>();

  for (const [monthKey, entries] of Object.entries(breakdown)) {
    const year = parseInt(monthKey.slice(0, 4), 10);
    if (isNaN(year)) continue;

    if (!byYear.has(year)) {
      byYear.set(year, {});
    }
    byYear.get(year)![monthKey] = entries;
  }

  return byYear;
}

/**
 * Aggregate supplier matches from a MonthlyBreakdown
 */
export function aggregateSupplierMatchesFromBreakdown(
  breakdown: MonthlyBreakdown
): Array<{
  bkmvName: string;
  amount: number;
  transactionCount: number;
  matchedSupplierId: string | null;
  matchedSupplierName: string | null;
}> {
  const supplierMap = new Map<
    string,
    {
      amount: number;
      transactionCount: number;
      supplierId: string | null;
    }
  >();

  for (const entries of Object.values(breakdown)) {
    for (const entry of entries) {
      const existing = supplierMap.get(entry.supplierName);
      if (existing) {
        existing.amount += entry.amount;
        existing.transactionCount += entry.transactionCount;
        if (!existing.supplierId && entry.supplierId) {
          existing.supplierId = entry.supplierId;
        }
      } else {
        supplierMap.set(entry.supplierName, {
          amount: entry.amount,
          transactionCount: entry.transactionCount,
          supplierId: entry.supplierId,
        });
      }
    }
  }

  return Array.from(supplierMap.entries())
    .map(([bkmvName, data]) => ({
      bkmvName,
      amount: data.amount,
      transactionCount: data.transactionCount,
      matchedSupplierId: data.supplierId,
      matchedSupplierName: null,
    }))
    .sort((a, b) => b.amount - a.amount);
}
