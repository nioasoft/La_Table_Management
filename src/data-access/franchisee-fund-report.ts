import { database } from "@/db";
import {
  commission,
  supplier,
  franchisee,
  brand,
  supplierBrand,
} from "@/db/schema";
import { eq, and, gte, lte, inArray, sql } from "drizzle-orm";

// ============================================================================
// TYPES
// ============================================================================

export interface FranchiseeFundReportFilters {
  year: number;
  quarter: 1 | 2 | 3 | 4;
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
  periodStartDate: string;
  periodEndDate: string;
  suppliers: FranchiseeFundSupplierRow[];
  franchisees: FranchiseeFundFranchiseeColumn[];
  grandTotals: {
    totalCommissions: number;
    totalFund: number;
    totalGrossAmount: number;
  };
  generatedAt: string;
}

// ============================================================================
// UTILITY FUNCTIONS
// ============================================================================

/**
 * Get the date range for a calendar quarter
 */
export function getQuarterDateRange(year: number, quarter: 1 | 2 | 3 | 4): { startDate: string; endDate: string } {
  const quarterStartMonth = (quarter - 1) * 3; // 0, 3, 6, 9
  const startDate = new Date(year, quarterStartMonth, 1);
  const endDate = new Date(year, quarterStartMonth + 3, 0); // Last day of the quarter

  const formatDate = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, '0');
    const d = String(date.getDate()).padStart(2, '0');
    return `${y}-${m}-${d}`;
  };

  return {
    startDate: formatDate(startDate),
    endDate: formatDate(endDate),
  };
}

// ============================================================================
// DATA ACCESS FUNCTIONS
// ============================================================================

/**
 * Get franchisee fund report data
 * Shows commission breakdown by supplier and franchisee for suppliers with franchisee fund enabled
 */
export async function getFranchiseeFundReport(
  filters: FranchiseeFundReportFilters
): Promise<FranchiseeFundReport> {
  const { year, quarter, brandId } = filters;
  const { startDate, endDate } = getQuarterDateRange(year, quarter);

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
  // Also filter by brand if provided
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
      periodStartDate: startDate,
      periodEndDate: endDate,
      suppliers: [],
      franchisees: [],
      grandTotals: {
        totalCommissions: 0,
        totalFund: 0,
        totalGrossAmount: 0,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  const supplierIds = fundSuppliers.map(s => s.id);

  // Build commission query conditions
  const commissionConditions = [
    inArray(commission.supplierId, supplierIds),
    gte(commission.periodStartDate, startDate),
    lte(commission.periodEndDate, endDate),
  ];

  // Get all commissions for these suppliers in the period
  // Join with franchisee to get brand info
  let commissionsQuery = database
    .select({
      supplierId: commission.supplierId,
      franchiseeId: commission.franchiseeId,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      brandId: franchisee.brandId,
      grossAmount: commission.grossAmount,
      commissionAmount: commission.commissionAmount,
      commissionRate: commission.commissionRate,
    })
    .from(commission)
    .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id));

  // Add brand filter if provided
  if (brandId) {
    commissionConditions.push(eq(franchisee.brandId, brandId));
  }

  const commissions = await commissionsQuery.where(and(...commissionConditions));

  // Build the report data structures
  const supplierMap = new Map<string, typeof fundSuppliers[0]>();
  for (const s of fundSuppliers) {
    supplierMap.set(s.id, s);
  }

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

  for (const c of commissions) {
    const supplierData = supplierMap.get(c.supplierId);
    if (!supplierData) continue;

    const totalCommissionRate = Number(supplierData.defaultCommissionRate || 0);
    const fundRate = Number(supplierData.franchiseeFundPercentage || 0);
    const grossAmount = Number(c.grossAmount || 0);
    const totalCommission = Number(c.commissionAmount || 0);

    // Calculate fund portion: fund% of grossAmount
    // Fund is calculated as a portion of the gross amount, not the commission
    const fundAmount = (grossAmount * fundRate) / 100;
    const regularCommission = totalCommission - fundAmount;

    // Initialize or get supplier row
    if (!supplierRowsMap.has(c.supplierId)) {
      supplierRowsMap.set(c.supplierId, {
        supplierId: c.supplierId,
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

    const supplierRow = supplierRowsMap.get(c.supplierId)!;

    // Initialize or update cell
    if (!supplierRow.cells[c.franchiseeId]) {
      supplierRow.cells[c.franchiseeId] = {
        grossAmount: 0,
        totalCommission: 0,
        regularCommission: 0,
        fundAmount: 0,
      };
    }

    const cell = supplierRow.cells[c.franchiseeId];
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
    if (!franchiseeMap.has(c.franchiseeId)) {
      franchiseeMap.set(c.franchiseeId, {
        id: c.franchiseeId,
        name: c.franchiseeName,
        code: c.franchiseeCode,
        totalCommissions: 0,
        totalFund: 0,
      });
    }
    const fData = franchiseeMap.get(c.franchiseeId)!;
    fData.totalCommissions += regularCommission;
    fData.totalFund += fundAmount;
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
    totalGrossAmount: supplierRows.reduce((sum, s) => sum + s.totals.grossAmount, 0),
  };

  return {
    brandId: brandId || null,
    brandName: brandInfo?.nameHe || null,
    year,
    quarter,
    periodStartDate: startDate,
    periodEndDate: endDate,
    suppliers: supplierRows,
    franchisees: franchiseeColumns,
    grandTotals,
    generatedAt: new Date().toISOString(),
  };
}
