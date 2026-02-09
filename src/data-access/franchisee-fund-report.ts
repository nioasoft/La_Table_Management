import { database } from "@/db";
import {
  supplier,
  franchisee,
  brand,
  supplierBrand,
  franchiseeBkmvYear,
} from "@/db/schema";
import { eq, and, inArray, sql } from "drizzle-orm";

// ============================================================================
// TYPES
// ============================================================================

export interface FranchiseeFundReportFilters {
  year: number;
  quarter: 1 | 2 | 3 | 4; // Kept for UI compatibility, but data is yearly
  brandId?: string;
}

export interface FranchiseeFundCell {
  grossAmount: number;
  totalCommission: number;
  regularCommission: number;
  fundAmount: number;
}

export interface FranchiseeFundSupplierRow {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  totalCommissionRate: number;
  fundRate: number;
  cells: Record<string, FranchiseeFundCell>; // franchiseeId -> cell
  totals: {
    grossAmount: number;
    totalCommission: number;
    regularCommission: number;
    fundAmount: number;
  };
}

export interface FranchiseeFundFranchiseeColumn {
  franchiseeId: string;
  franchiseeName: string;
  franchiseeCode: string;
  totalCommissions: number;
  totalFund: number;
}

export interface FranchiseeFundReport {
  brandId: string | null;
  brandName: string | null;
  year: number;
  quarter: 1 | 2 | 3 | 4;
  isYearlyData: boolean; // Flag to indicate data is for the full year
  suppliers: FranchiseeFundSupplierRow[];
  franchisees: FranchiseeFundFranchiseeColumn[];
  grandTotals: {
    totalCommissions: number;
    totalFund: number;
  };
  generatedAt: string;
}

// ============================================================================
// TYPES FOR BKMV DATA
// ============================================================================

interface SupplierMatchEntry {
  bkmvName: string;
  amount: number;
  transactionCount: number;
  matchedSupplierId: string | null;
  matchedSupplierName: string | null;
}

// ============================================================================
// DATA ACCESS FUNCTIONS
// ============================================================================

/**
 * Get franchisee fund report data
 * Shows commission breakdown by supplier and franchisee for suppliers with franchisee fund enabled
 *
 * Data source: franchisee_bkmv_year table (yearly BKMV data aggregations)
 * Note: Data is yearly, not quarterly. Quarter filter is kept for UI compatibility.
 */
export async function getFranchiseeFundReport(
  filters: FranchiseeFundReportFilters
): Promise<FranchiseeFundReport> {
  const { year, quarter, brandId } = filters;

  // Get brand info if filtering by brand
  let brandInfo: { id: string; nameHe: string } | null = null;
  if (brandId) {
    const brandResult = await database
      .select({ id: brand.id, nameHe: brand.nameHe })
      .from(brand)
      .where(eq(brand.id, brandId))
      .limit(1);
    if (brandResult.length > 0) {
      brandInfo = brandResult[0];
    }
  }

  // Get suppliers with franchisee fund enabled
  let fundSuppliersQuery = database
    .select({
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
      defaultCommissionRate: supplier.defaultCommissionRate,
      franchiseeFundPercentage: supplier.franchiseeFundPercentage,
    })
    .from(supplier)
    .where(
      and(
        eq(supplier.franchiseeFundEnabled, true),
        eq(supplier.isActive, true),
        eq(supplier.isHidden, false)
      )
    );

  let fundSuppliers = await fundSuppliersQuery;

  // If brandId is provided, filter to only suppliers associated with that brand
  if (brandId) {
    const supplierBrandLinks = await database
      .select({ supplierId: supplierBrand.supplierId })
      .from(supplierBrand)
      .where(eq(supplierBrand.brandId, brandId));
    const supplierIdsForBrand = new Set(supplierBrandLinks.map(sb => sb.supplierId));
    fundSuppliers = fundSuppliers.filter(s => supplierIdsForBrand.has(s.id));
  }

  if (fundSuppliers.length === 0) {
    return {
      brandId: brandId || null,
      brandName: brandInfo?.nameHe || null,
      year,
      quarter,
      isYearlyData: true,
      suppliers: [],
      franchisees: [],
      grandTotals: {
        totalCommissions: 0,
        totalFund: 0,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // Create a map of supplier IDs for quick lookup
  const fundSupplierIds = new Set(fundSuppliers.map(s => s.id));
  const supplierMap = new Map<string, typeof fundSuppliers[0]>();
  for (const s of fundSuppliers) {
    supplierMap.set(s.id, s);
  }

  // Build query conditions for franchisee_bkmv_year
  const bkmvConditions = [eq(franchiseeBkmvYear.year, year)];

  // Get all BKMV year records for the specified year
  // Join with franchisee to get brand info and filter if needed
  let bkmvQuery = database
    .select({
      franchiseeId: franchiseeBkmvYear.franchiseeId,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      brandId: franchisee.brandId,
      supplierMatches: franchiseeBkmvYear.supplierMatches,
    })
    .from(franchiseeBkmvYear)
    .innerJoin(franchisee, eq(franchiseeBkmvYear.franchiseeId, franchisee.id));

  // Add brand filter if provided
  if (brandId) {
    bkmvConditions.push(eq(franchisee.brandId, brandId));
  }

  const bkmvRecords = await bkmvQuery.where(and(...bkmvConditions));

  // Track franchisees
  const franchiseeMap = new Map<string, {
    id: string;
    name: string;
    code: string;
    totalCommissions: number;
    totalFund: number;
  }>();

  // Build supplier rows
  const supplierRowsMap = new Map<string, FranchiseeFundSupplierRow>();

  // Process each BKMV year record
  for (const record of bkmvRecords) {
    const supplierMatches = record.supplierMatches as SupplierMatchEntry[] | null;
    if (!supplierMatches || !Array.isArray(supplierMatches)) continue;

    // Process each supplier match entry
    for (const match of supplierMatches) {
      // Skip entries without a matched supplier or non-fund suppliers
      if (!match.matchedSupplierId) continue;
      if (!fundSupplierIds.has(match.matchedSupplierId)) continue;

      const supplierData = supplierMap.get(match.matchedSupplierId);
      if (!supplierData) continue;

      const totalCommissionRate = Number(supplierData.defaultCommissionRate || 0);
      const fundRate = Number(supplierData.franchiseeFundPercentage || 0);
      const grossAmount = Number(match.amount || 0);

      // Calculate commission and fund amounts
      // totalCommission = grossAmount × defaultCommissionRate / 100
      // fundAmount = grossAmount × fundRate / 100
      // regularCommission = totalCommission - fundAmount
      const totalCommission = (grossAmount * totalCommissionRate) / 100;
      const fundAmount = (grossAmount * fundRate) / 100;
      const regularCommission = totalCommission - fundAmount;

      // Initialize or get supplier row
      if (!supplierRowsMap.has(match.matchedSupplierId)) {
        supplierRowsMap.set(match.matchedSupplierId, {
          supplierId: match.matchedSupplierId,
          supplierName: supplierData.name,
          supplierCode: supplierData.code,
          totalCommissionRate,
          fundRate,
          cells: {},
          totals: {
            grossAmount: 0,
            totalCommission: 0,
            regularCommission: 0,
            fundAmount: 0,
          },
        });
      }

      const supplierRow = supplierRowsMap.get(match.matchedSupplierId)!;

      // Initialize or update cell
      if (!supplierRow.cells[record.franchiseeId]) {
        supplierRow.cells[record.franchiseeId] = {
          grossAmount: 0,
          totalCommission: 0,
          regularCommission: 0,
          fundAmount: 0,
        };
      }

      const cell = supplierRow.cells[record.franchiseeId];
      cell.grossAmount += grossAmount;
      cell.totalCommission += totalCommission;
      cell.regularCommission += regularCommission;
      cell.fundAmount += fundAmount;

      // Update supplier totals
      supplierRow.totals.grossAmount += grossAmount;
      supplierRow.totals.totalCommission += totalCommission;
      supplierRow.totals.regularCommission += regularCommission;
      supplierRow.totals.fundAmount += fundAmount;

      // Track franchisee
      if (!franchiseeMap.has(record.franchiseeId)) {
        franchiseeMap.set(record.franchiseeId, {
          id: record.franchiseeId,
          name: record.franchiseeName,
          code: record.franchiseeCode,
          totalCommissions: 0,
          totalFund: 0,
        });
      }
      const fData = franchiseeMap.get(record.franchiseeId)!;
      fData.totalCommissions += regularCommission;
      fData.totalFund += fundAmount;
    }
  }

  // Convert to arrays
  const supplierRows = Array.from(supplierRowsMap.values())
    .sort((a, b) => a.supplierName.localeCompare(b.supplierName, 'he'));

  const franchiseeColumns = Array.from(franchiseeMap.values())
    .map(f => ({
      franchiseeId: f.id,
      franchiseeName: f.name,
      franchiseeCode: f.code,
      totalCommissions: f.totalCommissions,
      totalFund: f.totalFund,
    }))
    .sort((a, b) => a.franchiseeName.localeCompare(b.franchiseeName, 'he'));

  // Calculate grand totals
  const grandTotals = {
    totalCommissions: supplierRows.reduce((sum, s) => sum + s.totals.regularCommission, 0),
    totalFund: supplierRows.reduce((sum, s) => sum + s.totals.fundAmount, 0),
  };

  return {
    brandId: brandId || null,
    brandName: brandInfo?.nameHe || null,
    year,
    quarter,
    isYearlyData: true,
    suppliers: supplierRows,
    franchisees: franchiseeColumns,
    grandTotals,
    generatedAt: new Date().toISOString(),
  };
}
