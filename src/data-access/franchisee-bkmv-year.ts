/**
 * Data Access Layer for Franchisee BKMV Year
 *
 * Handles year-based archiving of BKMV monthly data per franchisee.
 * Complete years (12 months) are locked from overwrite; incomplete years get replaced on new upload.
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
  reason?: "year_complete";
  record?: FranchiseeBkmvYear;
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
 * If the year is already complete (12 months), skip unless forceOverwrite is true.
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

  if (existing.length > 0 && existing[0].isComplete && !opts?.forceOverwrite) {
    return { skipped: true, reason: "year_complete" };
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

    return { skipped: false, record: updated };
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

    return { skipped: false, record: inserted };
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
  opts?: { forceOverwrite?: boolean }
): Promise<{ updated: number[]; skipped: number[] }> {
  if (!monthlyBreakdown || Object.keys(monthlyBreakdown).length === 0) {
    return { updated: [], skipped: [] };
  }

  const byYear = groupMonthlyBreakdownByYear(monthlyBreakdown);
  const updated: number[] = [];
  const skipped: number[] = [];

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
    }
  }

  return { updated, skipped };
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
