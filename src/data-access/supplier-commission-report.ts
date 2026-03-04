import { database } from "@/db";
import {
  supplier,
  franchisee,
  brand,
  supplierBrand,
  supplierFileUpload,
  uploadedFile,
  type SupplierFileProcessingResult,
  type SupplierFileMapping,
  type BkmvProcessingResult,
} from "@/db/schema";
import { eq, and, inArray, gte, lte, or, isNotNull, desc } from "drizzle-orm";
import { getVatRateForDate } from "@/data-access/vatRates";
import { calculateNetFromGross, roundToTwoDecimals } from "@/lib/file-processor";

// ============================================================================
// TYPES
// ============================================================================

export interface SupplierCommissionReportFilters {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  brandId?: string;
}

export interface SupplierCommissionCell {
  grossAmount: number;
  netAmount: number;
  commissionAmount: number;
  commissionAmountBeforeVat: number;
}

export interface SupplierCommissionRow {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  commissionRate: number;
  isVatExempt: boolean;
  cells: Record<string, SupplierCommissionCell>; // franchiseeId -> cell
  totalCommission: number;
  totalCommissionBeforeVat: number;
  percentOfTurnover: number | null;
}

export interface SupplierCommissionFranchiseeColumn {
  franchiseeId: string;
  franchiseeName: string;
  franchiseeCode: string;
  totalCommission: number;
  totalCommissionBeforeVat: number;
  bkmvRevenue: number;
}

export interface SupplierCommissionReport {
  year: number;
  quarter: 1 | 2 | 3 | 4;
  brandId: string | null;
  brandName: string | null;
  suppliers: SupplierCommissionRow[];
  franchisees: SupplierCommissionFranchiseeColumn[];
  grandTotals: {
    totalCommission: number;
    totalCommissionBeforeVat: number;
    totalBkmvRevenue: number;
    overallPercentOfTurnover: number | null;
  };
  generatedAt: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function getQuarterDateRange(
  year: number,
  quarter: 1 | 2 | 3 | 4
): { startDate: string; endDate: string; months: string[] } {
  const startMonth = (quarter - 1) * 3;
  const start = new Date(year, startMonth, 1);
  const end = new Date(year, startMonth + 3, 0);

  const formatLocalDate = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  // Build list of months in the quarter (e.g. ["2025-01", "2025-02", "2025-03"])
  const months: string[] = [];
  for (let i = 0; i < 3; i++) {
    const m = startMonth + i + 1; // 1-based
    months.push(`${year}-${String(m).padStart(2, "0")}`);
  }

  return {
    startDate: formatLocalDate(start),
    endDate: formatLocalDate(end),
    months,
  };
}

function emptyReport(
  year: number,
  quarter: 1 | 2 | 3 | 4,
  brandId: string | undefined,
  brandName: string | null
): SupplierCommissionReport {
  return {
    year,
    quarter,
    brandId: brandId || null,
    brandName,
    suppliers: [],
    franchisees: [],
    grandTotals: {
      totalCommission: 0,
      totalCommissionBeforeVat: 0,
      totalBkmvRevenue: 0,
      overallPercentOfTurnover: null,
    },
    generatedAt: new Date().toISOString(),
  };
}

// ============================================================================
// DATA ACCESS
// ============================================================================

/**
 * Get supplier commission matrix report
 *
 * Builds a matrix of suppliers x franchisees showing commission amounts
 * plus a "% of turnover" column using BKMV revenue data.
 */
export async function getSupplierCommissionReport(
  filters: SupplierCommissionReportFilters
): Promise<SupplierCommissionReport> {
  const { year, quarter, brandId } = filters;
  const { startDate: quarterStart, endDate: quarterEnd, months } =
    getQuarterDateRange(year, quarter);

  // Get brand info if filtering
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

  // Get ALL active, non-hidden suppliers (not just fund-enabled)
  let activeSuppliers = await database
    .select({
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
      defaultCommissionRate: supplier.defaultCommissionRate,
      commissionType: supplier.commissionType,
      vatExempt: supplier.vatExempt,
      vatIncluded: supplier.vatIncluded,
      fileMapping: supplier.fileMapping,
    })
    .from(supplier)
    .where(and(eq(supplier.isActive, true), eq(supplier.isHidden, false)));

  // If brandId is provided, filter to only suppliers associated with that brand
  if (brandId) {
    const supplierBrandLinks = await database
      .select({ supplierId: supplierBrand.supplierId })
      .from(supplierBrand)
      .where(eq(supplierBrand.brandId, brandId));
    const supplierIdsForBrand = new Set(
      supplierBrandLinks.map((sb) => sb.supplierId)
    );
    activeSuppliers = activeSuppliers.filter((s) =>
      supplierIdsForBrand.has(s.id)
    );
  }

  if (activeSuppliers.length === 0) {
    return emptyReport(year, quarter, brandId, brandInfo?.nameHe || null);
  }

  const supplierIds = activeSuppliers.map((s) => s.id);
  const supplierMap = new Map<string, (typeof activeSuppliers)[0]>();
  for (const s of activeSuppliers) {
    supplierMap.set(s.id, s);
  }

  // Get VAT rate for the quarter
  const quarterStartMonth = (quarter - 1) * 3;
  const periodDate = new Date(year, quarterStartMonth, 1);
  const vatRate = await getVatRateForDate(periodDate);

  // Query supplier file uploads for the quarter (ordered by newest first for dedup)
  const rawFileRecords = await database
    .select({
      supplierId: supplierFileUpload.supplierId,
      processingResult: supplierFileUpload.processingResult,
      periodStartDate: supplierFileUpload.periodStartDate,
      periodEndDate: supplierFileUpload.periodEndDate,
      createdAt: supplierFileUpload.createdAt,
    })
    .from(supplierFileUpload)
    .where(
      and(
        inArray(supplierFileUpload.supplierId, supplierIds),
        or(
          eq(supplierFileUpload.processingStatus, "auto_approved"),
          eq(supplierFileUpload.processingStatus, "approved")
        ),
        lte(supplierFileUpload.periodStartDate, quarterEnd),
        gte(supplierFileUpload.periodEndDate, quarterStart)
      )
    )
    .orderBy(desc(supplierFileUpload.createdAt));

  // Deduplicate files per supplier per period
  // Single-file suppliers: keep only the latest file per (supplier, period)
  // Multi-file suppliers: keep all files per period
  const fileRecords: typeof rawFileRecords = [];
  const seenSupplierPeriods = new Set<string>();

  for (const file of rawFileRecords) {
    const sData = supplierMap.get(file.supplierId);
    if (!sData) continue;

    const fm = sData.fileMapping as SupplierFileMapping | null;
    const isMultiFile = (fm?.maxUploadFiles ?? 1) > 1;

    if (isMultiFile) {
      // Multi-file suppliers: include ALL files for the period
      fileRecords.push(file);
    } else {
      // Single-file suppliers: only the latest per (supplier, periodStart, periodEnd)
      const periodKey = `${file.supplierId}|${file.periodStartDate}|${file.periodEndDate}`;
      if (!seenSupplierPeriods.has(periodKey)) {
        seenSupplierPeriods.add(periodKey);
        fileRecords.push(file);
      }
    }
  }

  // Collect all matched franchisee IDs
  const allFranchiseeIds = new Set<string>();
  for (const file of fileRecords) {
    const result = file.processingResult as SupplierFileProcessingResult | null;
    if (!result?.franchiseeMatches) continue;
    for (const match of result.franchiseeMatches) {
      if (
        match.matchedFranchiseeId &&
        match.matchType !== "blacklisted" &&
        match.matchType !== "fuzzy" &&
        match.matchType !== "none"
      ) {
        allFranchiseeIds.add(match.matchedFranchiseeId);
      }
    }
  }

  if (allFranchiseeIds.size === 0) {
    return emptyReport(year, quarter, brandId, brandInfo?.nameHe || null);
  }

  // Fetch franchisee details
  const franchiseeDetails = await database
    .select({
      id: franchisee.id,
      name: franchisee.name,
      code: franchisee.code,
      brandId: franchisee.brandId,
    })
    .from(franchisee)
    .where(inArray(franchisee.id, Array.from(allFranchiseeIds)));

  const franchiseeDetailMap = new Map<string, (typeof franchiseeDetails)[0]>();
  for (const f of franchiseeDetails) {
    franchiseeDetailMap.set(f.id, f);
  }

  // ---- BKMV REVENUE ----
  // Fetch revenue data from uploaded BKMV files for the quarter
  const bkmvFiles = await database
    .select({
      franchiseeId: uploadedFile.franchiseeId,
      processingResult: uploadedFile.bkmvProcessingResult,
      createdAt: uploadedFile.createdAt,
    })
    .from(uploadedFile)
    .where(
      and(
        isNotNull(uploadedFile.bkmvProcessingResult),
        isNotNull(uploadedFile.franchiseeId),
        lte(uploadedFile.periodStartDate, quarterEnd),
        gte(uploadedFile.periodEndDate, quarterStart),
        inArray(uploadedFile.processingStatus, ["approved", "auto_approved"])
      )
    )
    .orderBy(desc(uploadedFile.createdAt));

  // Aggregate revenue per franchisee per month (latest file per month wins)
  // This handles franchisees who upload monthly files separately instead of one quarterly file
  const revenueMap = new Map<string, number>();
  const seenFranchiseeMonths = new Map<string, Set<string>>();

  for (const file of bkmvFiles) {
    const fId = file.franchiseeId!;
    const result = file.processingResult as BkmvProcessingResult | null;
    if (!result?.revenueMonthlyBreakdown) continue;

    if (!seenFranchiseeMonths.has(fId)) {
      seenFranchiseeMonths.set(fId, new Set());
    }
    const seenMonths = seenFranchiseeMonths.get(fId)!;

    for (const [month, amount] of Object.entries(
      result.revenueMonthlyBreakdown
    )) {
      // Only include months in the requested quarter, and only the latest file per month
      if (months.includes(month) && !seenMonths.has(month)) {
        seenMonths.add(month);
        const prev = revenueMap.get(fId) || 0;
        revenueMap.set(fId, prev + (amount as number));
      }
    }
  }

  // ---- BUILD MATRIX ----
  // Track franchisees for columns
  const franchiseeColumnMap = new Map<
    string,
    {
      id: string;
      name: string;
      code: string;
      totalCommission: number;
      totalCommissionBeforeVat: number;
      bkmvRevenue: number;
    }
  >();

  // Build supplier rows
  const supplierRowsMap = new Map<
    string,
    {
      supplierId: string;
      supplierName: string;
      supplierCode: string;
      commissionRate: number;
      isVatExempt: boolean;
      cells: Record<string, SupplierCommissionCell>;
      totalCommission: number;
      totalCommissionBeforeVat: number;
    }
  >();

  for (const file of fileRecords) {
    const result = file.processingResult as SupplierFileProcessingResult | null;
    if (!result?.franchiseeMatches) continue;

    const supplierData = supplierMap.get(file.supplierId);
    if (!supplierData) continue;

    const commissionRate = Number(supplierData.defaultCommissionRate || 0);
    const commissionType = supplierData.commissionType || "percentage";
    const isVatExempt = supplierData.vatExempt;

    // For per_item suppliers, use processedRows from file processing result
    const processedRows = result.processedRows || 0;

    for (const match of result.franchiseeMatches) {
      if (!match.matchedFranchiseeId) continue;
      if (
        match.matchType === "blacklisted" ||
        match.matchType === "fuzzy" ||
        match.matchType === "none"
      )
        continue;

      const fDetail = franchiseeDetailMap.get(match.matchedFranchiseeId);
      if (!fDetail) continue;

      // Apply brand filter on franchisee level
      if (brandId && fDetail.brandId !== brandId) continue;

      const grossAmount = Number(match.grossAmount || 0);

      // Calculate net amount (before VAT)
      // grossAmount from file processing already accounts for vatIncluded:
      // - If vatIncluded=true: grossAmount = original amount (includes VAT)
      // - If vatIncluded=false: grossAmount = original * (1 + VAT) (VAT was added)
      const netAmount = isVatExempt
        ? grossAmount
        : calculateNetFromGross(grossAmount, vatRate);

      // Commission amounts depend on commission type
      let commissionAmount: number;
      let commissionAmountBeforeVat: number;

      if (commissionType === "per_item") {
        // Per-item commission: rate is ₪ per item, not a percentage
        // Use pre-calculated commission from match if available, otherwise estimate
        const matchCommission = Number(match.preCalculatedCommission || 0);
        if (matchCommission > 0) {
          commissionAmount = matchCommission;
          commissionAmountBeforeVat = isVatExempt
            ? matchCommission
            : calculateNetFromGross(matchCommission, vatRate);
        } else {
          // Fallback: distribute file-level per-item commission proportionally
          // Total file commission = processedRows * rate
          const totalFileCommission = processedRows * commissionRate;
          const totalFileGross = result.totalGrossAmount || 1;
          const proportion = totalFileGross > 0 ? grossAmount / totalFileGross : 0;
          commissionAmount = totalFileCommission * proportion;
          commissionAmountBeforeVat = isVatExempt
            ? commissionAmount
            : calculateNetFromGross(commissionAmount, vatRate);
        }
      } else {
        // Percentage commission
        // Use supplier's pre-calculated commission when available
        // (e.g., for suppliers with variable rates per product like Avrahami)
        const matchCommission = Number(match.preCalculatedCommission || 0);
        if (matchCommission > 0) {
          // preCalculatedCommission is calculated on net sale amounts = commission before VAT
          commissionAmountBeforeVat = matchCommission;
          commissionAmount = isVatExempt
            ? matchCommission
            : matchCommission * (1 + vatRate);
        } else {
          commissionAmount = (grossAmount * commissionRate) / 100;
          commissionAmountBeforeVat = (netAmount * commissionRate) / 100;
        }
      }

      // Initialize or get supplier row
      if (!supplierRowsMap.has(file.supplierId)) {
        supplierRowsMap.set(file.supplierId, {
          supplierId: file.supplierId,
          supplierName: supplierData.name,
          supplierCode: supplierData.code,
          commissionRate,
          isVatExempt,
          cells: {},
          totalCommission: 0,
          totalCommissionBeforeVat: 0,
        });
      }

      const supplierRow = supplierRowsMap.get(file.supplierId)!;

      // Initialize or update cell
      if (!supplierRow.cells[match.matchedFranchiseeId]) {
        supplierRow.cells[match.matchedFranchiseeId] = {
          grossAmount: 0,
          netAmount: 0,
          commissionAmount: 0,
          commissionAmountBeforeVat: 0,
        };
      }

      const cell = supplierRow.cells[match.matchedFranchiseeId];
      cell.grossAmount += grossAmount;
      cell.netAmount += netAmount;
      cell.commissionAmount += commissionAmount;
      cell.commissionAmountBeforeVat += commissionAmountBeforeVat;

      // Update supplier totals
      supplierRow.totalCommission += commissionAmount;
      supplierRow.totalCommissionBeforeVat += commissionAmountBeforeVat;

      // Track franchisee column
      if (!franchiseeColumnMap.has(match.matchedFranchiseeId)) {
        franchiseeColumnMap.set(match.matchedFranchiseeId, {
          id: match.matchedFranchiseeId,
          name: fDetail.name,
          code: fDetail.code,
          totalCommission: 0,
          totalCommissionBeforeVat: 0,
          bkmvRevenue: revenueMap.get(match.matchedFranchiseeId) || 0,
        });
      }
      const fCol = franchiseeColumnMap.get(match.matchedFranchiseeId)!;
      fCol.totalCommission += commissionAmount;
      fCol.totalCommissionBeforeVat += commissionAmountBeforeVat;
    }
  }

  // Calculate total BKMV revenue across all franchisees that appear in the matrix
  let totalBkmvRevenue = 0;
  for (const fCol of franchiseeColumnMap.values()) {
    totalBkmvRevenue += fCol.bkmvRevenue;
  }

  // Convert supplier rows to array and calculate % of turnover
  const supplierRows: SupplierCommissionRow[] = Array.from(
    supplierRowsMap.values()
  )
    .map((row) => ({
      ...row,
      totalCommission: roundToTwoDecimals(row.totalCommission),
      totalCommissionBeforeVat: roundToTwoDecimals(
        row.totalCommissionBeforeVat
      ),
      percentOfTurnover:
        totalBkmvRevenue > 0
          ? roundToTwoDecimals(
              (row.totalCommissionBeforeVat / totalBkmvRevenue) * 100
            )
          : null,
    }))
    .sort((a, b) => a.supplierName.localeCompare(b.supplierName, "he"));

  // Convert franchisee columns to array
  const franchiseeColumns: SupplierCommissionFranchiseeColumn[] = Array.from(
    franchiseeColumnMap.values()
  )
    .map((f) => ({
      franchiseeId: f.id,
      franchiseeName: f.name,
      franchiseeCode: f.code,
      totalCommission: roundToTwoDecimals(f.totalCommission),
      totalCommissionBeforeVat: roundToTwoDecimals(f.totalCommissionBeforeVat),
      bkmvRevenue: roundToTwoDecimals(f.bkmvRevenue),
    }))
    .sort((a, b) => a.franchiseeName.localeCompare(b.franchiseeName, "he"));

  // Grand totals
  const grandTotalCommission = supplierRows.reduce(
    (sum, s) => sum + s.totalCommission,
    0
  );
  const grandTotalCommissionBeforeVat = supplierRows.reduce(
    (sum, s) => sum + s.totalCommissionBeforeVat,
    0
  );

  return {
    year,
    quarter,
    brandId: brandId || null,
    brandName: brandInfo?.nameHe || null,
    suppliers: supplierRows,
    franchisees: franchiseeColumns,
    grandTotals: {
      totalCommission: roundToTwoDecimals(grandTotalCommission),
      totalCommissionBeforeVat: roundToTwoDecimals(
        grandTotalCommissionBeforeVat
      ),
      totalBkmvRevenue: roundToTwoDecimals(totalBkmvRevenue),
      overallPercentOfTurnover:
        totalBkmvRevenue > 0
          ? roundToTwoDecimals(
              (grandTotalCommissionBeforeVat / totalBkmvRevenue) * 100
            )
          : null,
    },
    generatedAt: new Date().toISOString(),
  };
}
