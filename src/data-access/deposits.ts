/**
 * Data access functions for deposits tracking report
 *
 * Deposits are tracked as adjustments with type "deposit" in the adjustments table.
 * This report shows deposit balances, history, and summary by franchisee.
 */

import { database } from "@/db";
import {
  adjustment,
  settlementPeriod,
  franchisee,
  brand,
  user,
} from "@/db/schema";
import { eq, and, desc, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";

// ============================================================================
// TYPES
// ============================================================================

export interface DepositEntry {
  id: string;
  franchiseeId: string;
  franchiseeName: string;
  brandId: string;
  brandNameHe: string;
  settlementPeriodId: string;
  settlementPeriodName: string;
  periodStartDate: string;
  periodEndDate: string;
  amount: number;
  reason: string;
  description: string | null;
  referenceNumber: string | null;
  effectiveDate: string | null;
  approvedAt: Date | null;
  approvedByName: string | null;
  createdAt: Date;
  createdByName: string | null;
  /** Running balance up to this deposit (chronological) */
  runningBalance: number;
  /** Supplier ID if stored in metadata */
  supplierId: string | null;
  /** Supplier name if stored in metadata */
  supplierName: string | null;
}

export interface DepositSummaryByFranchisee {
  franchiseeId: string;
  franchiseeName: string;
  brandId: string;
  brandNameHe: string;
  totalDeposits: number;
  depositCount: number;
  lastDepositDate: string | null;
  /** Running balance (positive = credit to franchisee, negative = debit) */
  runningBalance: number;
}

export interface DepositSummaryByBrand {
  brandId: string;
  brandNameHe: string;
  brandNameEn: string | null;
  totalDeposits: number;
  depositCount: number;
  franchiseeCount: number;
}

export interface DepositsReport {
  summary: {
    totalDeposits: number;
    totalDepositAmount: number;
    affectedFranchisees: number;
    periodRange: {
      startDate: string | null;
      endDate: string | null;
    };
    generatedAt: string;
    /** Whether supplier dimension is available in the data */
    hasSupplierDimension: boolean;
  };
  byFranchisee: DepositSummaryByFranchisee[];
  byBrand: DepositSummaryByBrand[];
  details: DepositEntry[];
}

export interface DepositsFilters {
  brandId?: string;
  franchiseeId?: string;
  startDate?: string;
  endDate?: string;
  minAmount?: number;
}

// ============================================================================
// DATA ACCESS
// ============================================================================

/**
 * Get deposits report
 * Aggregates deposit adjustments across franchisees and periods
 */
export async function getDepositsReport(
  filters: DepositsFilters = {}
): Promise<DepositsReport> {
  // Build conditions for deposit adjustments
  const conditions = [eq(adjustment.adjustmentType, "deposit")];

  if (filters.startDate) {
    conditions.push(sql`${adjustment.effectiveDate} >= ${filters.startDate}`);
  }

  if (filters.endDate) {
    conditions.push(sql`${adjustment.effectiveDate} <= ${filters.endDate}`);
  }

  // Query all deposit adjustments with related data
  const deposits = await database
    .select({
      id: adjustment.id,
      amount: adjustment.amount,
      reason: adjustment.reason,
      description: adjustment.description,
      referenceNumber: adjustment.referenceNumber,
      effectiveDate: adjustment.effectiveDate,
      approvedAt: adjustment.approvedAt,
      createdAt: adjustment.createdAt,
      metadata: adjustment.metadata,
      settlementPeriodId: settlementPeriod.id,
      settlementPeriodName: settlementPeriod.name,
      periodStartDate: settlementPeriod.periodStartDate,
      periodEndDate: settlementPeriod.periodEndDate,
      franchiseeId: franchisee.id,
      franchiseeName: franchisee.name,
      brandId: brand.id,
      brandNameHe: brand.nameHe,
      brandNameEn: brand.nameEn,
      approvedByName: sql<string | null>`approved_user.name`,
      createdByName: sql<string | null>`created_user.name`,
    })
    .from(adjustment)
    .leftJoin(settlementPeriod, eq(adjustment.settlementPeriodId, settlementPeriod.id))
    .leftJoin(franchisee, eq(settlementPeriod.franchiseeId, franchisee.id))
    .leftJoin(brand, eq(franchisee.brandId, brand.id))
    .leftJoin(
      sql`${user} as approved_user`,
      sql`${adjustment.approvedBy} = approved_user.id`
    )
    .leftJoin(
      sql`${user} as created_user`,
      sql`${adjustment.createdBy} = created_user.id`
    )
    .where(and(...conditions))
    .orderBy(desc(adjustment.createdAt));

  // Filter by brandId if specified
  let filteredDeposits = filters.brandId
    ? deposits.filter((d) => d.brandId === filters.brandId)
    : deposits;

  // Filter by franchiseeId if specified
  if (filters.franchiseeId) {
    filteredDeposits = filteredDeposits.filter(
      (d) => d.franchiseeId === filters.franchiseeId
    );
  }

  // Filter by minimum amount if specified
  if (filters.minAmount) {
    filteredDeposits = filteredDeposits.filter(
      (d) => Math.abs(Number(d.amount)) >= filters.minAmount!
    );
  }

  // Calculate summary statistics
  let totalDepositAmount = 0;
  let minDate: string | null = null;
  let maxDate: string | null = null;
  const franchiseeSet = new Set<string>();

  // Aggregate by franchisee
  const franchiseeMap = new Map<
    string,
    {
      franchiseeId: string;
      franchiseeName: string;
      brandId: string;
      brandNameHe: string;
      totalDeposits: number;
      depositCount: number;
      lastDepositDate: string | null;
    }
  >();

  // Aggregate by brand
  const brandMap = new Map<
    string,
    {
      brandId: string;
      brandNameHe: string;
      brandNameEn: string | null;
      totalDeposits: number;
      depositCount: number;
      franchisees: Set<string>;
    }
  >();

  for (const deposit of filteredDeposits) {
    const amount = Number(deposit.amount);
    totalDepositAmount += amount;

    // Track franchisees
    if (deposit.franchiseeId) {
      franchiseeSet.add(deposit.franchiseeId);
    }

    // Track date range
    const effectiveDate = deposit.effectiveDate || deposit.periodStartDate;
    if (effectiveDate) {
      if (!minDate || effectiveDate < minDate) minDate = effectiveDate;
      if (!maxDate || effectiveDate > maxDate) maxDate = effectiveDate;
    }

    // Aggregate by franchisee
    if (deposit.franchiseeId && deposit.franchiseeName) {
      if (!franchiseeMap.has(deposit.franchiseeId)) {
        franchiseeMap.set(deposit.franchiseeId, {
          franchiseeId: deposit.franchiseeId,
          franchiseeName: deposit.franchiseeName,
          brandId: deposit.brandId || "",
          brandNameHe: deposit.brandNameHe || "",
          totalDeposits: 0,
          depositCount: 0,
          lastDepositDate: null,
        });
      }
      const franchiseeData = franchiseeMap.get(deposit.franchiseeId)!;
      franchiseeData.totalDeposits += amount;
      franchiseeData.depositCount += 1;
      const depositDate = deposit.effectiveDate || deposit.periodStartDate;
      if (
        depositDate &&
        (!franchiseeData.lastDepositDate || depositDate > franchiseeData.lastDepositDate)
      ) {
        franchiseeData.lastDepositDate = depositDate;
      }
    }

    // Aggregate by brand
    if (deposit.brandId && deposit.brandNameHe) {
      if (!brandMap.has(deposit.brandId)) {
        brandMap.set(deposit.brandId, {
          brandId: deposit.brandId,
          brandNameHe: deposit.brandNameHe,
          brandNameEn: deposit.brandNameEn,
          totalDeposits: 0,
          depositCount: 0,
          franchisees: new Set(),
        });
      }
      const brandData = brandMap.get(deposit.brandId)!;
      brandData.totalDeposits += amount;
      brandData.depositCount += 1;
      if (deposit.franchiseeId) {
        brandData.franchisees.add(deposit.franchiseeId);
      }
    }
  }

  // Convert maps to arrays
  const byFranchisee: DepositSummaryByFranchisee[] = Array.from(
    franchiseeMap.values()
  )
    .map((f) => ({
      ...f,
      runningBalance: f.totalDeposits, // Running balance is the cumulative sum
    }))
    .sort((a, b) => Math.abs(b.totalDeposits) - Math.abs(a.totalDeposits));

  const byBrand: DepositSummaryByBrand[] = Array.from(brandMap.values())
    .map((b) => ({
      brandId: b.brandId,
      brandNameHe: b.brandNameHe,
      brandNameEn: b.brandNameEn,
      totalDeposits: b.totalDeposits,
      depositCount: b.depositCount,
      franchiseeCount: b.franchisees.size,
    }))
    .sort((a, b) => Math.abs(b.totalDeposits) - Math.abs(a.totalDeposits));

  // Helper to extract supplier info from metadata
  const extractSupplierFromMetadata = (metadata: unknown): { supplierId: string | null; supplierName: string | null } => {
    if (!metadata || typeof metadata !== "object") {
      return { supplierId: null, supplierName: null };
    }
    const meta = metadata as Record<string, unknown>;
    return {
      supplierId: typeof meta.supplierId === "string" ? meta.supplierId : null,
      supplierName: typeof meta.supplierName === "string" ? meta.supplierName : null,
    };
  };

  // Sort deposits chronologically for running balance calculation
  const sortedDeposits = [...filteredDeposits].sort((a, b) => {
    const dateA = new Date(a.effectiveDate || a.periodStartDate || a.createdAt).getTime();
    const dateB = new Date(b.effectiveDate || b.periodStartDate || b.createdAt).getTime();
    return dateA - dateB;
  });

  // Calculate chronological running balance and check for supplier data
  let runningTotal = 0;
  let hasSupplierDimension = false;
  const depositsWithBalance = sortedDeposits.map((d) => {
    const amount = Number(d.amount);
    runningTotal += amount;
    const supplierInfo = extractSupplierFromMetadata(d.metadata);
    if (supplierInfo.supplierId || supplierInfo.supplierName) {
      hasSupplierDimension = true;
    }
    return {
      ...d,
      runningBalance: runningTotal,
      supplierId: supplierInfo.supplierId,
      supplierName: supplierInfo.supplierName,
    };
  });

  // Build details array (sorted chronologically with running balance)
  const details: DepositEntry[] = depositsWithBalance.map((d) => ({
    id: d.id,
    franchiseeId: d.franchiseeId || "",
    franchiseeName: d.franchiseeName || "",
    brandId: d.brandId || "",
    brandNameHe: d.brandNameHe || "",
    settlementPeriodId: d.settlementPeriodId || "",
    settlementPeriodName: d.settlementPeriodName || "",
    periodStartDate: d.periodStartDate || "",
    periodEndDate: d.periodEndDate || "",
    amount: Number(d.amount),
    reason: d.reason,
    description: d.description,
    referenceNumber: d.referenceNumber,
    effectiveDate: d.effectiveDate,
    approvedAt: d.approvedAt,
    approvedByName: d.approvedByName,
    createdAt: d.createdAt,
    createdByName: d.createdByName,
    runningBalance: d.runningBalance,
    supplierId: d.supplierId,
    supplierName: d.supplierName,
  }));

  return {
    summary: {
      totalDeposits: filteredDeposits.length,
      totalDepositAmount,
      affectedFranchisees: franchiseeSet.size,
      periodRange: {
        startDate: minDate,
        endDate: maxDate,
      },
      generatedAt: new Date().toISOString(),
      hasSupplierDimension,
    },
    byFranchisee,
    byBrand,
    details,
  };
}

/**
 * Get filter options for deposits report
 * Cached for 5 minutes to reduce database queries
 */
export const getDepositsFilterOptions = unstable_cache(
  async () => {
    const [brands, franchisees] = await Promise.all([
      database
        .select({ id: brand.id, nameHe: brand.nameHe, nameEn: brand.nameEn })
        .from(brand)
        .where(eq(brand.isActive, true)),
      database
        .select({
          id: franchisee.id,
          name: franchisee.name,
          brandId: franchisee.brandId,
        })
        .from(franchisee)
        .where(eq(franchisee.isActive, true)),
    ]);

    return { brands, franchisees };
  },
  ["deposits-filter-options"],
  { revalidate: 300 } // 5 minutes
);
