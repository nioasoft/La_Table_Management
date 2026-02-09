import { database } from "@/db";
import {
  supplier,
  franchisee,
  brand,
  supplierBrand,
  commission,
} from "@/db/schema";
import { eq, and, inArray, not, gte, lte } from "drizzle-orm";

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
  suppliers: FranchiseeFundSupplierRow[];
  franchisees: FranchiseeFundFranchiseeColumn[];
  grandTotals: {
    totalCommissions: number;
    totalFund: number;
  };
  generatedAt: string;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get the date range for a given year and quarter
 * Returns YYYY-MM-DD strings for start and end dates
 */
function getQuarterDateRange(
  year: number,
  quarter: 1 | 2 | 3 | 4
): { startDate: string; endDate: string } {
  const startMonth = (quarter - 1) * 3; // 0, 3, 6, 9
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0); // last day of quarter

  const formatLocalDate = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  return {
    startDate: formatLocalDate(start),
    endDate: formatLocalDate(end),
  };
}

// ============================================================================
// DATA ACCESS FUNCTIONS
// ============================================================================

/**
 * Get franchisee fund report data
 * Shows commission breakdown by supplier and franchisee for suppliers with franchisee fund enabled
 *
 * Data source: commission table (supplier-reported data)
 * Filtered by quarter using periodStartDate/periodEndDate
 */
export async function getFranchiseeFundReport(
  filters: FranchiseeFundReportFilters
): Promise<FranchiseeFundReport> {
  const { year, quarter, brandId } = filters;
  const { startDate: quarterStart, endDate: quarterEnd } = getQuarterDateRange(
    year,
    quarter
  );

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
  let fundSuppliers = await database
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

  // If brandId is provided, filter to only suppliers associated with that brand
  if (brandId) {
    const supplierBrandLinks = await database
      .select({ supplierId: supplierBrand.supplierId })
      .from(supplierBrand)
      .where(eq(supplierBrand.brandId, brandId));
    const supplierIdsForBrand = new Set(
      supplierBrandLinks.map((sb) => sb.supplierId)
    );
    fundSuppliers = fundSuppliers.filter((s) => supplierIdsForBrand.has(s.id));
  }

  if (fundSuppliers.length === 0) {
    return {
      brandId: brandId || null,
      brandName: brandInfo?.nameHe || null,
      year,
      quarter,
      suppliers: [],
      franchisees: [],
      grandTotals: {
        totalCommissions: 0,
        totalFund: 0,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // Create maps for quick lookup
  const fundSupplierIds = fundSuppliers.map((s) => s.id);
  const supplierMap = new Map<string, (typeof fundSuppliers)[0]>();
  for (const s of fundSuppliers) {
    supplierMap.set(s.id, s);
  }

  // Query commission records for the quarter, filtered to fund suppliers
  const conditions = [
    inArray(commission.supplierId, fundSupplierIds),
    not(eq(commission.status, "cancelled")),
    gte(commission.periodStartDate, quarterStart),
    lte(commission.periodEndDate, quarterEnd),
  ];

  if (brandId) {
    conditions.push(eq(franchisee.brandId, brandId));
  }

  const commissionRecords = await database
    .select({
      supplierId: commission.supplierId,
      franchiseeId: commission.franchiseeId,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      brandId: franchisee.brandId,
      grossAmount: commission.grossAmount,
    })
    .from(commission)
    .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
    .where(and(...conditions));

  // Track franchisees
  const franchiseeMap = new Map<
    string,
    {
      id: string;
      name: string;
      code: string;
      totalCommissions: number;
      totalFund: number;
    }
  >();

  // Build supplier rows
  const supplierRowsMap = new Map<string, FranchiseeFundSupplierRow>();

  // Process each commission record
  for (const record of commissionRecords) {
    const supplierData = supplierMap.get(record.supplierId);
    if (!supplierData) continue;

    const totalCommissionRate = Number(
      supplierData.defaultCommissionRate || 0
    );
    const fundRate = Number(supplierData.franchiseeFundPercentage || 0);
    const grossAmount = Number(record.grossAmount || 0);

    // Calculate commission and fund amounts
    // totalCommission = grossAmount × defaultCommissionRate / 100
    // fundAmount = grossAmount × fundRate / 100
    // regularCommission = totalCommission - fundAmount
    const totalCommission = (grossAmount * totalCommissionRate) / 100;
    const fundAmount = (grossAmount * fundRate) / 100;
    const regularCommission = totalCommission - fundAmount;

    // Initialize or get supplier row
    if (!supplierRowsMap.has(record.supplierId)) {
      supplierRowsMap.set(record.supplierId, {
        supplierId: record.supplierId,
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

    const supplierRow = supplierRowsMap.get(record.supplierId)!;

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
    fData.totalCommissions += totalCommission;
    fData.totalFund += fundAmount;
  }

  // Convert to arrays
  const supplierRows = Array.from(supplierRowsMap.values()).sort((a, b) =>
    a.supplierName.localeCompare(b.supplierName, "he")
  );

  const franchiseeColumns = Array.from(franchiseeMap.values())
    .map((f) => ({
      franchiseeId: f.id,
      franchiseeName: f.name,
      franchiseeCode: f.code,
      totalCommissions: f.totalCommissions,
      totalFund: f.totalFund,
    }))
    .sort((a, b) =>
      a.franchiseeName.localeCompare(b.franchiseeName, "he")
    );

  // Calculate grand totals
  const grandTotals = {
    totalCommissions: supplierRows.reduce(
      (sum, s) => sum + s.totals.totalCommission,
      0
    ),
    totalFund: supplierRows.reduce(
      (sum, s) => sum + s.totals.fundAmount,
      0
    ),
  };

  return {
    brandId: brandId || null,
    brandName: brandInfo?.nameHe || null,
    year,
    quarter,
    suppliers: supplierRows,
    franchisees: franchiseeColumns,
    grandTotals,
    generatedAt: new Date().toISOString(),
  };
}
