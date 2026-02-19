import { database } from "@/db";
import {
  supplier,
  franchisee,
  brand,
  supplierBrand,
  supplierFileUpload,
  type SupplierFileProcessingResult,
} from "@/db/schema";
import { eq, and, inArray, gte, lte, or } from "drizzle-orm";
import { getVatRateForDate } from "@/data-access/vatRates";
import { calculateNetFromGross, roundToTwoDecimals } from "@/lib/file-processor";

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
  netAmount: number; // grossAmount before VAT
  totalCommission: number;
  totalCommissionBeforeVat: number;
  regularCommission: number;
  regularCommissionBeforeVat: number;
  fundAmount: number;
  fundAmountBeforeVat: number;
}

export interface FranchiseeFundSupplierRow {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  totalCommissionRate: number;
  fundRate: number;
  isVatExempt: boolean;
  cells: Record<string, FranchiseeFundCell>; // franchiseeId -> cell
  totals: {
    grossAmount: number;
    netAmount: number;
    totalCommission: number;
    totalCommissionBeforeVat: number;
    regularCommission: number;
    regularCommissionBeforeVat: number;
    fundAmount: number;
    fundAmountBeforeVat: number;
  };
}

export interface FranchiseeFundFranchiseeColumn {
  franchiseeId: string;
  franchiseeName: string;
  franchiseeCode: string;
  totalCommissions: number;
  totalCommissionsBeforeVat: number;
  totalFund: number;
  totalFundBeforeVat: number;
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
    totalCommissionsBeforeVat: number;
    totalFund: number;
    totalFundBeforeVat: number;
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
 * Data source: supplier_file_upload table (supplier-reported files)
 * Uses processingResult.franchiseeMatches for amounts per franchisee
 * Filtered by quarter using periodStartDate/periodEndDate overlap
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
      vatExempt: supplier.vatExempt,
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
        totalCommissionsBeforeVat: 0,
        totalFund: 0,
        totalFundBeforeVat: 0,
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

  // Get VAT rate for the quarter start date
  const quarterStartMonth = (quarter - 1) * 3; // 0, 3, 6, 9
  const periodDate = new Date(year, quarterStartMonth, 1);
  const vatRate = await getVatRateForDate(periodDate);

  // Query supplier file uploads for the quarter
  // Files overlap with the quarter if: file.start <= quarterEnd AND file.end >= quarterStart
  const fileRecords = await database
    .select({
      supplierId: supplierFileUpload.supplierId,
      processingResult: supplierFileUpload.processingResult,
    })
    .from(supplierFileUpload)
    .where(
      and(
        inArray(supplierFileUpload.supplierId, fundSupplierIds),
        or(
          eq(supplierFileUpload.processingStatus, "auto_approved"),
          eq(supplierFileUpload.processingStatus, "approved")
        ),
        lte(supplierFileUpload.periodStartDate, quarterEnd),
        gte(supplierFileUpload.periodEndDate, quarterStart)
      )
    );

  // Build a set of all matched franchisee IDs so we can look up their details
  const allFranchiseeIds = new Set<string>();
  for (const file of fileRecords) {
    const result = file.processingResult as SupplierFileProcessingResult | null;
    if (!result?.franchiseeMatches) continue;
    for (const match of result.franchiseeMatches) {
      if (match.matchedFranchiseeId && match.matchType !== "blacklisted") {
        allFranchiseeIds.add(match.matchedFranchiseeId);
      }
    }
  }

  if (allFranchiseeIds.size === 0) {
    return {
      brandId: brandId || null,
      brandName: brandInfo?.nameHe || null,
      year,
      quarter,
      suppliers: [],
      franchisees: [],
      grandTotals: {
        totalCommissions: 0,
        totalCommissionsBeforeVat: 0,
        totalFund: 0,
        totalFundBeforeVat: 0,
      },
      generatedAt: new Date().toISOString(),
    };
  }

  // Fetch franchisee details (name, code, brandId) for brand filtering
  const franchiseeDetails = await database
    .select({
      id: franchisee.id,
      name: franchisee.name,
      code: franchisee.code,
      brandId: franchisee.brandId,
    })
    .from(franchisee)
    .where(inArray(franchisee.id, Array.from(allFranchiseeIds)));

  const franchiseeDetailMap = new Map<
    string,
    (typeof franchiseeDetails)[0]
  >();
  for (const f of franchiseeDetails) {
    franchiseeDetailMap.set(f.id, f);
  }

  // Track franchisees for columns
  const franchiseeMap = new Map<
    string,
    {
      id: string;
      name: string;
      code: string;
      totalCommissions: number;
      totalCommissionsBeforeVat: number;
      totalFund: number;
      totalFundBeforeVat: number;
    }
  >();

  // Build supplier rows
  const supplierRowsMap = new Map<string, FranchiseeFundSupplierRow>();

  // Process each file's franchisee matches
  for (const file of fileRecords) {
    const result = file.processingResult as SupplierFileProcessingResult | null;
    if (!result?.franchiseeMatches) continue;

    const supplierData = supplierMap.get(file.supplierId);
    if (!supplierData) continue;

    const totalCommissionRate = Number(
      supplierData.defaultCommissionRate || 0
    );
    const fundRate = Number(supplierData.franchiseeFundPercentage || 0);

    for (const match of result.franchiseeMatches) {
      // Skip unmatched, blacklisted, or review-required entries
      if (!match.matchedFranchiseeId) continue;
      if (match.matchType === "blacklisted") continue;

      const fDetail = franchiseeDetailMap.get(match.matchedFranchiseeId);
      if (!fDetail) continue;

      // Apply brand filter on franchisee level
      if (brandId && fDetail.brandId !== brandId) continue;

      const grossAmount = Number(match.grossAmount || 0);

      // Calculate net amount (before VAT)
      const isVatExempt = supplierData.vatExempt;
      const netAmount = isVatExempt
        ? grossAmount
        : calculateNetFromGross(grossAmount, vatRate);

      // Calculate commission and fund amounts (on gross)
      const totalCommission = (grossAmount * totalCommissionRate) / 100;
      const fundAmount = (grossAmount * fundRate) / 100;
      const regularCommission = totalCommission - fundAmount;

      // Calculate before-VAT commission and fund amounts (on net)
      const totalCommissionBeforeVat = (netAmount * totalCommissionRate) / 100;
      const fundAmountBeforeVat = (netAmount * fundRate) / 100;
      const regularCommissionBeforeVat = totalCommissionBeforeVat - fundAmountBeforeVat;

      // Initialize or get supplier row
      if (!supplierRowsMap.has(file.supplierId)) {
        supplierRowsMap.set(file.supplierId, {
          supplierId: file.supplierId,
          supplierName: supplierData.name,
          supplierCode: supplierData.code,
          totalCommissionRate,
          fundRate,
          isVatExempt,
          cells: {},
          totals: {
            grossAmount: 0,
            netAmount: 0,
            totalCommission: 0,
            totalCommissionBeforeVat: 0,
            regularCommission: 0,
            regularCommissionBeforeVat: 0,
            fundAmount: 0,
            fundAmountBeforeVat: 0,
          },
        });
      }

      const supplierRow = supplierRowsMap.get(file.supplierId)!;

      // Initialize or update cell
      if (!supplierRow.cells[match.matchedFranchiseeId]) {
        supplierRow.cells[match.matchedFranchiseeId] = {
          grossAmount: 0,
          netAmount: 0,
          totalCommission: 0,
          totalCommissionBeforeVat: 0,
          regularCommission: 0,
          regularCommissionBeforeVat: 0,
          fundAmount: 0,
          fundAmountBeforeVat: 0,
        };
      }

      const cell = supplierRow.cells[match.matchedFranchiseeId];
      cell.grossAmount += grossAmount;
      cell.netAmount += netAmount;
      cell.totalCommission += totalCommission;
      cell.totalCommissionBeforeVat += totalCommissionBeforeVat;
      cell.regularCommission += regularCommission;
      cell.regularCommissionBeforeVat += regularCommissionBeforeVat;
      cell.fundAmount += fundAmount;
      cell.fundAmountBeforeVat += fundAmountBeforeVat;

      // Update supplier totals
      supplierRow.totals.grossAmount += grossAmount;
      supplierRow.totals.netAmount += netAmount;
      supplierRow.totals.totalCommission += totalCommission;
      supplierRow.totals.totalCommissionBeforeVat += totalCommissionBeforeVat;
      supplierRow.totals.regularCommission += regularCommission;
      supplierRow.totals.regularCommissionBeforeVat += regularCommissionBeforeVat;
      supplierRow.totals.fundAmount += fundAmount;
      supplierRow.totals.fundAmountBeforeVat += fundAmountBeforeVat;

      // Track franchisee
      if (!franchiseeMap.has(match.matchedFranchiseeId)) {
        franchiseeMap.set(match.matchedFranchiseeId, {
          id: match.matchedFranchiseeId,
          name: fDetail.name,
          code: fDetail.code,
          totalCommissions: 0,
          totalCommissionsBeforeVat: 0,
          totalFund: 0,
          totalFundBeforeVat: 0,
        });
      }
      const fData = franchiseeMap.get(match.matchedFranchiseeId)!;
      fData.totalCommissions += totalCommission;
      fData.totalCommissionsBeforeVat += totalCommissionBeforeVat;
      fData.totalFund += fundAmount;
      fData.totalFundBeforeVat += fundAmountBeforeVat;
    }
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
      totalCommissionsBeforeVat: f.totalCommissionsBeforeVat,
      totalFund: f.totalFund,
      totalFundBeforeVat: f.totalFundBeforeVat,
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
    totalCommissionsBeforeVat: supplierRows.reduce(
      (sum, s) => sum + s.totals.totalCommissionBeforeVat,
      0
    ),
    totalFund: supplierRows.reduce(
      (sum, s) => sum + s.totals.fundAmount,
      0
    ),
    totalFundBeforeVat: supplierRows.reduce(
      (sum, s) => sum + s.totals.fundAmountBeforeVat,
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
