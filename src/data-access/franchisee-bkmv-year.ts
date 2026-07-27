/**
 * Data Access Layer for Franchisee BKMV Year
 *
 * Handles year-based archiving of BKMV monthly data per franchisee.
 * New uploads merge months into existing year data (last-write-wins).
 */

import { database } from "@/db";
import {
  franchiseeBkmvYear,
  type FranchiseeBkmvYear,
} from "@/db/schema";
import { eq, and, gte, lte, sql } from "drizzle-orm";
import {
  type MonthlyBreakdown,
  groupMonthlyBreakdownByYear,
  aggregateSupplierMatchesFromBreakdown,
  getAmountForPeriod,
  mergeMonthlyBreakdown,
  changedMonths,
  groupIntoConsecutiveRuns,
} from "@/lib/bkmvdata-parser";

type SupplierMatchEntry = {
  bkmvName: string;
  amount: number;
  transactionCount: number;
  matchedSupplierId: string | null;
  matchedSupplierName: string | null;
};

interface UpsertResult {
  skipped: boolean;
  merged: boolean;
  reason?: "year_complete";
  record?: FranchiseeBkmvYear;
  /** Month keys ("YYYY-MM") whose data actually differs from what was stored. */
  changedMonths: string[];
}

/**
 * Extract which months (1-12) are covered in a MonthlyBreakdown for a specific year
 */
function extractMonthsCovered(
  breakdown: MonthlyBreakdown,
  year: number
): number[] {
  const months = new Set<number>();
  for (const key of Object.keys(breakdown)) {
    const [y, m] = key.split("-").map(Number);
    if (y === year && m >= 1 && m <= 12) {
      months.add(m);
    }
  }
  return Array.from(months).sort((a, b) => a - b);
}

/**
 * Upsert BKMV year data for a single year.
 * If the year already exists, merges new months into existing data (last-write-wins).
 * forceOverwrite = true replaces the entire year data without merging.
 */
export async function upsertBkmvYearData(
  franchiseeId: string,
  year: number,
  monthlyBreakdown: MonthlyBreakdown,
  supplierMatches: SupplierMatchEntry[] | null,
  sourceFileId: string | null,
  opts?: { forceOverwrite?: boolean }
): Promise<UpsertResult> {
  // Check if year already exists and is complete
  const existing = await database
    .select()
    .from(franchiseeBkmvYear)
    .where(
      and(
        eq(franchiseeBkmvYear.franchiseeId, franchiseeId),
        eq(franchiseeBkmvYear.year, year)
      )
    )
    .limit(1);

  // Which months this upload actually changes — computed against the stored
  // data BEFORE merging. Callers use it to avoid reacting to the months a
  // cumulative מבנה אחיד file merely repeats.
  const existingBreakdown =
    (existing[0]?.monthlyBreakdown as MonthlyBreakdown) || undefined;
  const monthsChanged = changedMonths(existingBreakdown, monthlyBreakdown);
  if (opts?.forceOverwrite && existingBreakdown) {
    // Full replacement also drops months the new file doesn't cover — a change too.
    for (const month of Object.keys(existingBreakdown)) {
      if (!(month in monthlyBreakdown)) monthsChanged.push(month);
    }
    monthsChanged.sort();
  }

  // If year exists: merge new months into existing data (last-write-wins)
  // forceOverwrite = true means full replacement (no merge)
  if (existing.length > 0 && !opts?.forceOverwrite) {
    monthlyBreakdown = mergeMonthlyBreakdown(existingBreakdown ?? {}, monthlyBreakdown);
    // Re-aggregate supplier matches from merged breakdown
    supplierMatches = aggregateSupplierMatchesFromBreakdown(monthlyBreakdown);
  }

  const monthsCovered = extractMonthsCovered(monthlyBreakdown, year);
  const monthCount = monthsCovered.length;
  const isComplete = monthCount === 12;

  // Build source file IDs array
  let sourceFileIds: string[] = [];
  if (existing.length > 0 && existing[0].sourceFileIds) {
    sourceFileIds = existing[0].sourceFileIds as string[];
  }
  if (sourceFileId && !sourceFileIds.includes(sourceFileId)) {
    sourceFileIds.push(sourceFileId);
  }

  const id = existing.length > 0 ? existing[0].id : crypto.randomUUID();

  if (existing.length > 0) {
    // Update existing record
    const [updated] = await database
      .update(franchiseeBkmvYear)
      .set({
        monthlyBreakdown: sql`${JSON.stringify(monthlyBreakdown)}::jsonb`,
        supplierMatches: supplierMatches
          ? sql`${JSON.stringify(supplierMatches)}::jsonb`
          : null,
        monthCount,
        monthsCovered: sql`${JSON.stringify(monthsCovered)}::jsonb`,
        isComplete,
        latestSourceFileId: sourceFileId,
        sourceFileIds: sql`${JSON.stringify(sourceFileIds)}::jsonb`,
        updatedAt: new Date(),
      })
      .where(eq(franchiseeBkmvYear.id, existing[0].id))
      .returning();

    return {
      skipped: false,
      merged: existing.length > 0,
      record: updated,
      changedMonths: monthsChanged,
    };
  } else {
    // Insert new record
    const [inserted] = await database
      .insert(franchiseeBkmvYear)
      .values({
        id,
        franchiseeId,
        year,
        monthlyBreakdown: sql`${JSON.stringify(monthlyBreakdown)}::jsonb`,
        supplierMatches: supplierMatches
          ? sql`${JSON.stringify(supplierMatches)}::jsonb`
          : null,
        monthCount,
        monthsCovered: sql`${JSON.stringify(monthsCovered)}::jsonb`,
        isComplete,
        latestSourceFileId: sourceFileId,
        sourceFileIds: sql`${JSON.stringify(sourceFileIds)}::jsonb`,
        createdAt: new Date(),
        updatedAt: new Date(),
      })
      .returning();

    return {
      skipped: false,
      merged: false,
      record: inserted,
      changedMonths: monthsChanged,
    };
  }
}

/**
 * Process a full MonthlyBreakdown, split by year, and upsert each year.
 * Returns summary of which years were updated vs skipped.
 */
export async function upsertFromFullBreakdown(
  franchiseeId: string,
  monthlyBreakdown: MonthlyBreakdown | undefined,
  supplierMatches: SupplierMatchEntry[] | null,
  sourceFileId: string | null,
  opts?: { forceOverwrite?: boolean; skipStaleMarking?: boolean }
): Promise<{
  updated: number[];
  skipped: number[];
  merged: number[];
  changedMonths: string[];
}> {
  if (!monthlyBreakdown || Object.keys(monthlyBreakdown).length === 0) {
    return { updated: [], skipped: [], merged: [], changedMonths: [] };
  }

  const byYear = groupMonthlyBreakdownByYear(monthlyBreakdown);
  const updated: number[] = [];
  const skipped: number[] = [];
  const merged: number[] = [];
  const monthsChanged: string[] = [];

  for (const [year, yearBreakdown] of byYear) {
    const yearSupplierMatches =
      aggregateSupplierMatchesFromBreakdown(yearBreakdown);

    const result = await upsertBkmvYearData(
      franchiseeId,
      year,
      yearBreakdown,
      yearSupplierMatches,
      sourceFileId,
      opts
    );

    if (result.skipped) {
      skipped.push(year);
    } else {
      updated.push(year);
      if (result.merged) {
        merged.push(year);
      }
    }
    monthsChanged.push(...result.changedMonths);
  }

  // A franchisee's BKMV data just changed — any active reconciliation session
  // that includes this franchisee and overlaps the CHANGED months now has a
  // stale franchisee-side amount. Flag those sessions so the UI prompts a
  // rebuild. מבנה אחיד files are cumulative from January, so flagging by the
  // file's whole span would re-flag every closed period of the year on each
  // quarterly upload — hence changed months only, grouped into runs so an
  // upload touching Jan and Jul doesn't drag Feb–Jun along. Best-effort;
  // dynamic import avoids a circular dependency with reconciliation-v2
  // (which imports from this module).
  //
  // skipStaleMarking is for bulk backfills that replay SEVERAL overlapping
  // files for the same franchisee: each replay is diffed against the state the
  // previous one left, so months flip back and forth and every flip reads as a
  // change even when the end state is identical. Such callers own the flagging
  // and should compare the year data once, before and after the whole run.
  const months = [
    ...new Set(monthsChanged.filter((k) => /^\d{4}-\d{2}$/.test(k))),
  ].sort();

  try {
    if (months.length > 0 && !opts?.skipStaleMarking) {
      const { markFranchiseeSessionsStale } = await import("@/data-access/reconciliation-v2");
      for (const [first, last] of groupIntoConsecutiveRuns(months)) {
        const [ey, em] = last.split("-").map(Number);
        // new Date(year, month, 0).getDate() → last day of that 1-indexed month
        const periodEnd = `${last}-${String(new Date(ey, em, 0).getDate()).padStart(2, "0")}`;
        await markFranchiseeSessionsStale(franchiseeId, `${first}-01`, periodEnd);
      }
    }
  } catch (staleErr) {
    console.error("Failed to flag reconciliation sessions stale after BKMV upsert:", staleErr);
  }

  return { updated, skipped, merged, changedMonths: months };
}

/**
 * Get all BKMV year records for a franchisee
 */
export async function getBkmvYearsForFranchisee(
  franchiseeId: string
): Promise<FranchiseeBkmvYear[]> {
  return database
    .select()
    .from(franchiseeBkmvYear)
    .where(eq(franchiseeBkmvYear.franchiseeId, franchiseeId))
    .orderBy(franchiseeBkmvYear.year);
}

/**
 * Get a single BKMV year record
 */
export async function getBkmvYearData(
  franchiseeId: string,
  year: number
): Promise<FranchiseeBkmvYear | null> {
  const result = await database
    .select()
    .from(franchiseeBkmvYear)
    .where(
      and(
        eq(franchiseeBkmvYear.franchiseeId, franchiseeId),
        eq(franchiseeBkmvYear.year, year)
      )
    )
    .limit(1);

  return result[0] || null;
}

/**
 * Get amount for a supplier from the year table for a specific period.
 * Queries relevant year records and uses getAmountForPeriod logic.
 */
export async function getAmountFromYearTable(
  franchiseeId: string,
  supplierId: string,
  periodStart: string,
  periodEnd: string
): Promise<{ amount: number; fileId: string | null } | null> {
  const startYear = parseInt(periodStart.slice(0, 4), 10);
  const endYear = parseInt(periodEnd.slice(0, 4), 10);

  const yearRecords = await database
    .select()
    .from(franchiseeBkmvYear)
    .where(
      and(
        eq(franchiseeBkmvYear.franchiseeId, franchiseeId),
        gte(franchiseeBkmvYear.year, startYear),
        lte(franchiseeBkmvYear.year, endYear)
      )
    );

  if (yearRecords.length === 0) return null;

  let totalAmount = 0;
  let hasData = false;
  let latestFileId: string | null = null;

  for (const record of yearRecords) {
    const breakdown = record.monthlyBreakdown as MonthlyBreakdown;
    const amount = getAmountForPeriod(breakdown, supplierId, periodStart, periodEnd);
    if (amount !== null) {
      totalAmount += amount;
      hasData = true;
      if (record.latestSourceFileId) {
        latestFileId = record.latestSourceFileId;
      }
    }
  }

  return hasData ? { amount: totalAmount, fileId: latestFileId } : null;
}

/**
 * Bulk query: get all franchisee amounts for a supplier in a period.
 * Returns Map<franchiseeId, { amount, fileId }>.
 */
export async function getAllFranchiseeAmountsFromYearTable(
  supplierId: string,
  periodStart: string,
  periodEnd: string
): Promise<Map<string, { amount: number; fileId: string | null }>> {
  const startYear = parseInt(periodStart.slice(0, 4), 10);
  const endYear = parseInt(periodEnd.slice(0, 4), 10);

  const yearRecords = await database
    .select()
    .from(franchiseeBkmvYear)
    .where(
      and(
        gte(franchiseeBkmvYear.year, startYear),
        lte(franchiseeBkmvYear.year, endYear)
      )
    );

  const result = new Map<string, { amount: number; fileId: string | null }>();

  for (const record of yearRecords) {
    const breakdown = record.monthlyBreakdown as MonthlyBreakdown;
    const amount = getAmountForPeriod(
      breakdown,
      supplierId,
      periodStart,
      periodEnd
    );

    if (amount !== null) {
      const existing = result.get(record.franchiseeId);
      if (existing) {
        existing.amount += amount;
        if (record.latestSourceFileId) {
          existing.fileId = record.latestSourceFileId;
        }
      } else {
        result.set(record.franchiseeId, {
          amount,
          fileId: record.latestSourceFileId,
        });
      }
    }
  }

  return result;
}

/**
 * Lock or unlock a year record (set isComplete)
 */
export async function setYearComplete(
  franchiseeId: string,
  year: number,
  isComplete: boolean
): Promise<FranchiseeBkmvYear | null> {
  const [updated] = await database
    .update(franchiseeBkmvYear)
    .set({ isComplete, updatedAt: new Date() })
    .where(
      and(
        eq(franchiseeBkmvYear.franchiseeId, franchiseeId),
        eq(franchiseeBkmvYear.year, year)
      )
    )
    .returning();

  return updated || null;
}
