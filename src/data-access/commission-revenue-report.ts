import { database } from "@/db";
import {
  supplier,
  franchisee,
  brand,
  supplierFileUpload,
  uploadedFile,
  type SupplierFileProcessingResult,
  type SupplierFileMapping,
  type BkmvProcessingResult,
} from "@/db/schema";
import { eq, and, inArray, gte, lte, or, isNotNull } from "drizzle-orm";

// ============================================================================
// TYPES
// ============================================================================

export interface CommissionRevenueReportFilters {
  year: number;
  quarter: 1 | 2 | 3 | 4 | "annual";
  brandId?: string;
}

export interface CommissionRevenueRow {
  franchiseeId: string;
  name: string;
  code: string;
  brandName: string;
  totalRevenue: number; // Revenue from BKMV files (turnover)
  totalSupplierPurchases: number; // Purchases from supplier files
  supplierPurchasesPercentage: number | null; // null when revenue is 0
}

export interface CommissionRevenueReport {
  rows: CommissionRevenueRow[];
  summary: {
    totalRevenue: number;
    totalSupplierPurchases: number;
    avgPercent: number;
    count: number;
  };
  year: number;
  quarter: 1 | 2 | 3 | 4 | "annual";
  brandId: string | null;
  brandName: string | null;
  generatedAt: string;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Get date range for a year/quarter or full year
 */
function getDateRange(
  year: number,
  quarter: 1 | 2 | 3 | 4 | "annual"
): { startDate: string; endDate: string; months: string[] } {
  const formatLocalDate = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  let startMonth: number;
  let endMonth: number;

  if (quarter === "annual") {
    startMonth = 0;
    endMonth = 11;
  } else {
    startMonth = (quarter - 1) * 3;
    endMonth = startMonth + 2;
  }

  const start = new Date(year, startMonth, 1);
  const end = new Date(year, endMonth + 1, 0); // last day of end month

  // Build months array (YYYY-MM format)
  const months: string[] = [];
  for (let m = startMonth; m <= endMonth; m++) {
    months.push(`${year}-${String(m + 1).padStart(2, "0")}`);
  }

  return {
    startDate: formatLocalDate(start),
    endDate: formatLocalDate(end),
    months,
  };
}

// ============================================================================
// MAIN FUNCTION
// ============================================================================

/**
 * Get supplier purchases-to-revenue ratio report
 *
 * Revenue (turnover): from uploaded_file.bkmvProcessingResult.revenueMonthlyBreakdown
 * Supplier Purchases: from supplier_file_upload.processingResult.franchiseeMatches (netAmount totals)
 */
export async function getCommissionRevenueReport(
  filters: CommissionRevenueReportFilters
): Promise<CommissionRevenueReport> {
  const { year, quarter, brandId } = filters;
  const { startDate, endDate, months } = getDateRange(year, quarter);

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

  // ---- BKMV FILES: Get revenue data from uploaded BKMV files ----
  const bkmvFiles = await database
    .select({
      franchiseeId: uploadedFile.franchiseeId,
      processingResult: uploadedFile.bkmvProcessingResult,
    })
    .from(uploadedFile)
    .where(
      and(
        isNotNull(uploadedFile.bkmvProcessingResult),
        isNotNull(uploadedFile.franchiseeId),
        lte(uploadedFile.periodStartDate, endDate),
        gte(uploadedFile.periodEndDate, startDate)
      )
    );

  // Aggregate revenue by franchiseeId from BKMV files
  const revenueMap = new Map<string, number>();
  for (const file of bkmvFiles) {
    const result = file.processingResult as BkmvProcessingResult | null;
    if (!result?.revenueMonthlyBreakdown) continue;

    for (const [month, amount] of Object.entries(result.revenueMonthlyBreakdown)) {
      // Only include months within the requested period
      if (months.includes(month)) {
        const prev = revenueMap.get(file.franchiseeId!) || 0;
        revenueMap.set(file.franchiseeId!, prev + (amount as number));
      }
    }
  }

  // ---- SUPPLIER FILES: Get all supplier file uploads for the period ----
  // Get all active non-hidden suppliers
  const activeSuppliers = await database
    .select({
      id: supplier.id,
      defaultCommissionRate: supplier.defaultCommissionRate,
      commissionType: supplier.commissionType,
      fileMapping: supplier.fileMapping,
    })
    .from(supplier)
    .where(and(eq(supplier.isActive, true), eq(supplier.isHidden, false)));

  const supplierIds = activeSuppliers.map((s) => s.id);
  if (supplierIds.length === 0 && revenueMap.size === 0) {
    return emptyReport(year, quarter, brandId, brandInfo);
  }

  const supplierRateMap = new Map<
    string,
    { rate: number; type: string | null }
  >();
  const supplierFileMappingMap = new Map<string, SupplierFileMapping | null>();
  for (const s of activeSuppliers) {
    supplierRateMap.set(s.id, {
      rate: Number(s.defaultCommissionRate || 0),
      type: s.commissionType,
    });
    supplierFileMappingMap.set(s.id, (s.fileMapping as SupplierFileMapping | null) ?? null);
  }

  // Query supplier file uploads overlapping the period
  const fileRecords =
    supplierIds.length > 0
      ? await database
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
              lte(supplierFileUpload.periodStartDate, endDate),
              gte(supplierFileUpload.periodEndDate, startDate)
            )
          )
      : [];

  // Deduplicate supplier files before aggregating purchases:
  // - Single-file suppliers: keep only latest file per supplier+period
  // - Multi-file suppliers (maxUploadFiles > 1): keep all files for same period
  type FileRecord = (typeof fileRecords)[number];
  const singleFileDedupMap = new Map<string, FileRecord>();
  const multiFileMatchesByKey = new Map<
    string,
    SupplierFileProcessingResult["franchiseeMatches"]
  >();

  for (const file of fileRecords) {
    const fm = supplierFileMappingMap.get(file.supplierId);
    const isMultiFile = ((fm?.maxUploadFiles as number | undefined) ?? 1) > 1;
    const dedupKey = `${file.supplierId}|${file.periodStartDate}|${file.periodEndDate}`;

    if (isMultiFile) {
      const result = file.processingResult as SupplierFileProcessingResult | null;
      if (result?.franchiseeMatches) {
        const existing = multiFileMatchesByKey.get(dedupKey) ?? [];
        existing.push(...result.franchiseeMatches);
        multiFileMatchesByKey.set(dedupKey, existing);
      }
    } else {
      const existing = singleFileDedupMap.get(dedupKey);
      if (!existing || file.createdAt > existing.createdAt) {
        singleFileDedupMap.set(dedupKey, file);
      }
    }
  }

  // Build purchasesMap from deduplicated data
  const purchasesMap = new Map<string, number>();

  const addMatchesToPurchases = (
    matches: SupplierFileProcessingResult["franchiseeMatches"]
  ) => {
    for (const match of matches) {
      if (!match.matchedFranchiseeId) continue;
      if (match.matchType === "blacklisted") continue;
      const purchaseAmount = match.netAmount || 0;
      const prev = purchasesMap.get(match.matchedFranchiseeId) || 0;
      purchasesMap.set(match.matchedFranchiseeId, prev + purchaseAmount);
    }
  };

  // Single-file suppliers (latest file only per supplier+period)
  for (const file of singleFileDedupMap.values()) {
    const result = file.processingResult as SupplierFileProcessingResult | null;
    if (result?.franchiseeMatches) {
      addMatchesToPurchases(result.franchiseeMatches);
    }
  }

  // Multi-file suppliers (all files merged per supplier+period)
  for (const matches of multiFileMatchesByKey.values()) {
    addMatchesToPurchases(matches);
  }

  // ---- JOIN: Merge revenue and purchases maps ----
  const allFranchiseeIds = new Set<string>([
    ...revenueMap.keys(),
    ...purchasesMap.keys(),
  ]);

  if (allFranchiseeIds.size === 0) {
    return emptyReport(year, quarter, brandId, brandInfo);
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

  // Get brand names for all relevant brands
  const franchiseeBrandIds = new Set(
    franchiseeDetails.map((f) => f.brandId).filter(Boolean) as string[]
  );
  const brandNames = new Map<string, string>();
  if (franchiseeBrandIds.size > 0) {
    const brandRows = await database
      .select({ id: brand.id, nameHe: brand.nameHe })
      .from(brand)
      .where(inArray(brand.id, Array.from(franchiseeBrandIds)));
    for (const b of brandRows) {
      brandNames.set(b.id, b.nameHe);
    }
  }

  // Build rows
  const rows: CommissionRevenueRow[] = [];
  for (const f of franchiseeDetails) {
    // Apply brand filter
    if (brandId && f.brandId !== brandId) continue;

    const revenue = revenueMap.get(f.id) || 0;
    const supplierPurchases = purchasesMap.get(f.id) || 0;

    // Skip franchisees with no data at all
    if (revenue === 0 && supplierPurchases === 0) continue;

    let supplierPurchasesPercentage: number | null;
    if (revenue > 0) {
      supplierPurchasesPercentage =
        Math.round((supplierPurchases / revenue) * 100 * 100) / 100;
    } else {
      // Has supplier purchases but no revenue data
      supplierPurchasesPercentage = null;
    }

    rows.push({
      franchiseeId: f.id,
      name: f.name,
      code: f.code,
      brandName: f.brandId ? brandNames.get(f.brandId) || "" : "",
      totalRevenue: Math.round(revenue * 100) / 100,
      totalSupplierPurchases: Math.round(supplierPurchases * 100) / 100,
      supplierPurchasesPercentage,
    });
  }

  // Sort by franchisee name (Hebrew)
  rows.sort((a, b) => a.name.localeCompare(b.name, "he"));

  // Compute summary
  const totalRevenue = rows.reduce((sum, r) => sum + r.totalRevenue, 0);
  const totalSupplierPurchases = rows.reduce(
    (sum, r) => sum + r.totalSupplierPurchases,
    0
  );
  const rowsWithRevenue = rows.filter((r) => r.totalRevenue > 0);
  const avgPercent =
    rowsWithRevenue.length > 0
      ? Math.round(
          (rowsWithRevenue.reduce(
            (sum, r) => sum + (r.supplierPurchasesPercentage || 0),
            0
          ) /
            rowsWithRevenue.length) *
            100
        ) / 100
      : 0;

  return {
    rows,
    summary: {
      totalRevenue: Math.round(totalRevenue * 100) / 100,
      totalSupplierPurchases: Math.round(totalSupplierPurchases * 100) / 100,
      avgPercent,
      count: rows.length,
    },
    year,
    quarter,
    brandId: brandId || null,
    brandName: brandInfo?.nameHe || null,
    generatedAt: new Date().toISOString(),
  };
}

function emptyReport(
  year: number,
  quarter: 1 | 2 | 3 | 4 | "annual",
  brandId: string | undefined,
  brandInfo: { id: string; nameHe: string } | null
): CommissionRevenueReport {
  return {
    rows: [],
    summary: {
      totalRevenue: 0,
      totalSupplierPurchases: 0,
      avgPercent: 0,
      count: 0,
    },
    year,
    quarter,
    brandId: brandId || null,
    brandName: brandInfo?.nameHe || null,
    generatedAt: new Date().toISOString(),
  };
}
