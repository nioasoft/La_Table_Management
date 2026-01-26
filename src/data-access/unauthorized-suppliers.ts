/**
 * Data access functions for unauthorized suppliers report
 *
 * Unauthorized suppliers are names that appear in BKMV files
 * but don't have a matching supplier record in the system.
 */

import { database } from "@/db";
import {
  uploadedFile,
  franchisee,
  brand,
  type BkmvProcessingResult,
} from "@/db/schema";
import { eq, and, isNotNull, desc, sql } from "drizzle-orm";
import { unstable_cache } from "next/cache";

// ============================================================================
// TYPES
// ============================================================================

export interface UnauthorizedSupplierEntry {
  /** Original name from BKMV file */
  bkmvName: string;
  /** Total purchase amount across all files */
  totalAmount: number;
  /** Total transaction count */
  transactionCount: number;
  /** Franchisees where this supplier appears */
  franchisees: Array<{
    id: string;
    name: string;
    brandNameHe: string;
    amount: number;
    fileCount: number;
  }>;
  /** First seen date */
  firstSeen: string;
  /** Last seen date */
  lastSeen: string;
  /** Number of files containing this supplier */
  fileCount: number;
}

export interface UnauthorizedSuppliersReport {
  summary: {
    totalUnauthorizedSuppliers: number;
    totalAmount: number;
    totalTransactions: number;
    affectedFranchisees: number;
    periodRange: {
      startDate: string | null;
      endDate: string | null;
    };
    generatedAt: string;
  };
  suppliers: UnauthorizedSupplierEntry[];
}

export interface UnauthorizedSuppliersFilters {
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
 * Get unauthorized suppliers report
 * Aggregates unmatched supplier names from BKMV processing results
 */
export async function getUnauthorizedSuppliersReport(
  filters: UnauthorizedSuppliersFilters = {}
): Promise<UnauthorizedSuppliersReport> {
  // Query all uploaded files with BKMV processing results
  const conditions = [
    isNotNull(uploadedFile.bkmvProcessingResult),
    eq(uploadedFile.processingStatus, "approved"),
  ];

  if (filters.franchiseeId) {
    conditions.push(eq(uploadedFile.franchiseeId, filters.franchiseeId));
  }

  if (filters.startDate) {
    conditions.push(sql`${uploadedFile.periodStartDate} >= ${filters.startDate}`);
  }

  if (filters.endDate) {
    conditions.push(sql`${uploadedFile.periodEndDate} <= ${filters.endDate}`);
  }

  const files = await database
    .select({
      id: uploadedFile.id,
      franchiseeId: uploadedFile.franchiseeId,
      franchiseeName: franchisee.name,
      brandId: franchisee.brandId,
      brandNameHe: brand.nameHe,
      periodStartDate: uploadedFile.periodStartDate,
      periodEndDate: uploadedFile.periodEndDate,
      bkmvProcessingResult: uploadedFile.bkmvProcessingResult,
      createdAt: uploadedFile.createdAt,
    })
    .from(uploadedFile)
    .leftJoin(franchisee, eq(uploadedFile.franchiseeId, franchisee.id))
    .leftJoin(brand, eq(franchisee.brandId, brand.id))
    .where(and(...conditions))
    .orderBy(desc(uploadedFile.createdAt));

  // Filter by brandId if specified (after join)
  const filteredFiles = filters.brandId
    ? files.filter((f) => f.brandId === filters.brandId)
    : files;

  // Aggregate unmatched suppliers across all files
  const supplierMap = new Map<
    string,
    {
      bkmvName: string;
      totalAmount: number;
      transactionCount: number;
      franchisees: Map<
        string,
        {
          id: string;
          name: string;
          brandNameHe: string;
          amount: number;
          fileCount: number;
        }
      >;
      firstSeen: Date;
      lastSeen: Date;
      fileCount: number;
    }
  >();

  let totalAmount = 0;
  let totalTransactions = 0;
  const franchiseeSet = new Set<string>();
  let minDate: string | null = null;
  let maxDate: string | null = null;

  for (const file of filteredFiles) {
    const result = file.bkmvProcessingResult as BkmvProcessingResult | null;
    if (!result?.supplierMatches) continue;

    // Update date range
    if (file.periodStartDate && (!minDate || file.periodStartDate < minDate)) {
      minDate = file.periodStartDate;
    }
    if (file.periodEndDate && (!maxDate || file.periodEndDate > maxDate)) {
      maxDate = file.periodEndDate;
    }

    // Process unmatched suppliers
    for (const match of result.supplierMatches) {
      // Skip matched suppliers
      if (match.matchedSupplierId) continue;

      // Apply minimum amount filter
      if (filters.minAmount && match.amount < filters.minAmount) continue;

      const normalizedName = match.bkmvName.toLowerCase().trim();

      totalAmount += match.amount;
      totalTransactions += match.transactionCount;

      if (file.franchiseeId) {
        franchiseeSet.add(file.franchiseeId);
      }

      if (!supplierMap.has(normalizedName)) {
        supplierMap.set(normalizedName, {
          bkmvName: match.bkmvName,
          totalAmount: 0,
          transactionCount: 0,
          franchisees: new Map(),
          firstSeen: file.createdAt,
          lastSeen: file.createdAt,
          fileCount: 0,
        });
      }

      const supplier = supplierMap.get(normalizedName)!;
      supplier.totalAmount += match.amount;
      supplier.transactionCount += match.transactionCount;
      supplier.fileCount += 1;

      if (file.createdAt < supplier.firstSeen) {
        supplier.firstSeen = file.createdAt;
      }
      if (file.createdAt > supplier.lastSeen) {
        supplier.lastSeen = file.createdAt;
      }

      // Track by franchisee
      if (file.franchiseeId && file.franchiseeName) {
        const franchiseeKey = file.franchiseeId;
        if (!supplier.franchisees.has(franchiseeKey)) {
          supplier.franchisees.set(franchiseeKey, {
            id: file.franchiseeId,
            name: file.franchiseeName,
            brandNameHe: file.brandNameHe || "",
            amount: 0,
            fileCount: 0,
          });
        }
        const franchiseeData = supplier.franchisees.get(franchiseeKey)!;
        franchiseeData.amount += match.amount;
        franchiseeData.fileCount += 1;
      }
    }
  }

  // Convert to array and sort by total amount
  const suppliers: UnauthorizedSupplierEntry[] = Array.from(supplierMap.values())
    .map((s) => ({
      bkmvName: s.bkmvName,
      totalAmount: s.totalAmount,
      transactionCount: s.transactionCount,
      franchisees: Array.from(s.franchisees.values()).sort(
        (a, b) => b.amount - a.amount
      ),
      firstSeen: s.firstSeen.toISOString(),
      lastSeen: s.lastSeen.toISOString(),
      fileCount: s.fileCount,
    }))
    .sort((a, b) => b.totalAmount - a.totalAmount);

  return {
    summary: {
      totalUnauthorizedSuppliers: suppliers.length,
      totalAmount,
      totalTransactions,
      affectedFranchisees: franchiseeSet.size,
      periodRange: {
        startDate: minDate,
        endDate: maxDate,
      },
      generatedAt: new Date().toISOString(),
    },
    suppliers,
  };
}

/**
 * Get filter options for unauthorized suppliers report
 * Cached for 5 minutes to reduce database queries
 */
export const getUnauthorizedSuppliersFilterOptions = unstable_cache(
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
  ["unauthorized-suppliers-filter-options"],
  { revalidate: 300 } // 5 minutes
);
