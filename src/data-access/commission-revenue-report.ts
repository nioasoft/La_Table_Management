import { database } from "@/db";
import {
  supplier,
  franchisee,
  brand,
  supplierFileUpload,
  type SupplierFileProcessingResult,
} from "@/db/schema";
import { eq, and, inArray, gte, lte, or } from "drizzle-orm";

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
  totalPurchases: number;
  totalCommissions: number;
  commissionPercentage: number | null; // null when purchases is 0 but commissions exist
}

export interface CommissionRevenueReport {
  rows: CommissionRevenueRow[];
  summary: {
    totalPurchases: number;
    totalCommissions: number;
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
 * Get commission-to-purchases ratio report
 *
 * Purchases: from supplier_file_upload.processingResult.franchiseeMatches (netAmount totals)
 * Commissions: from supplier_file_upload.processingResult.franchiseeMatches (calculated commissions)
 */
export async function getCommissionRevenueReport(
  filters: CommissionRevenueReportFilters
): Promise<CommissionRevenueReport> {
  const { year, quarter, brandId } = filters;
  const { startDate, endDate } = getDateRange(year, quarter);

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

  // ---- SUPPLIER FILES: Get all supplier file uploads for the period ----
  // Get all active non-hidden suppliers
  const activeSuppliers = await database
    .select({
      id: supplier.id,
      defaultCommissionRate: supplier.defaultCommissionRate,
      commissionType: supplier.commissionType,
    })
    .from(supplier)
    .where(and(eq(supplier.isActive, true), eq(supplier.isHidden, false)));

  const supplierIds = activeSuppliers.map((s) => s.id);
  if (supplierIds.length === 0) {
    return emptyReport(year, quarter, brandId, brandInfo);
  }

  const supplierRateMap = new Map<
    string,
    { rate: number; type: string | null }
  >();
  for (const s of activeSuppliers) {
    supplierRateMap.set(s.id, {
      rate: Number(s.defaultCommissionRate || 0),
      type: s.commissionType,
    });
  }

  // Query supplier file uploads overlapping the period
  const fileRecords = await database
    .select({
      supplierId: supplierFileUpload.supplierId,
      processingResult: supplierFileUpload.processingResult,
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
    );

  // Aggregate commissions and purchases by franchiseeId
  const commissionMap = new Map<string, number>();
  const purchasesMap = new Map<string, number>();

  for (const file of fileRecords) {
    const result = file.processingResult as SupplierFileProcessingResult | null;
    if (!result?.franchiseeMatches) continue;

    const supplierInfo = supplierRateMap.get(file.supplierId);
    const commissionRate = supplierInfo?.rate || 0;
    const commissionType = supplierInfo?.type;

    for (const match of result.franchiseeMatches) {
      if (!match.matchedFranchiseeId) continue;
      if (match.matchType === "blacklisted") continue;

      // Aggregate purchases (netAmount)
      const purchaseAmount = match.netAmount || 0;
      const prevPurchases = purchasesMap.get(match.matchedFranchiseeId) || 0;
      purchasesMap.set(match.matchedFranchiseeId, prevPurchases + purchaseAmount);

      // Calculate commission using the same logic as supplier-file-reports
      const matchAny = match as Record<string, unknown>;
      let matchCommission = 0;
      if (
        typeof matchAny.preCalculatedCommission === "number" &&
        matchAny.preCalculatedCommission > 0
      ) {
        matchCommission = matchAny.preCalculatedCommission;
      } else if (commissionRate && commissionType === "percentage") {
        matchCommission = (match.netAmount || 0) * (commissionRate / 100);
      }
      matchCommission = Math.trunc(matchCommission * 100) / 100;

      const prev = commissionMap.get(match.matchedFranchiseeId) || 0;
      commissionMap.set(match.matchedFranchiseeId, prev + matchCommission);
    }
  }

  // ---- JOIN: Merge purchases and commission maps ----
  const allFranchiseeIds = new Set<string>([
    ...purchasesMap.keys(),
    ...commissionMap.keys(),
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

    const purchases = purchasesMap.get(f.id) || 0;
    const commissions = commissionMap.get(f.id) || 0;

    // Skip franchisees with no data at all
    if (purchases === 0 && commissions === 0) continue;

    let commissionPercentage: number | null;
    if (purchases > 0) {
      commissionPercentage =
        Math.round((commissions / purchases) * 100 * 100) / 100;
    } else {
      // Has commissions but no purchases
      commissionPercentage = null;
    }

    rows.push({
      franchiseeId: f.id,
      name: f.name,
      code: f.code,
      brandName: f.brandId ? brandNames.get(f.brandId) || "" : "",
      totalPurchases: Math.round(purchases * 100) / 100,
      totalCommissions: Math.round(commissions * 100) / 100,
      commissionPercentage,
    });
  }

  // Sort by franchisee name (Hebrew)
  rows.sort((a, b) => a.name.localeCompare(b.name, "he"));

  // Compute summary
  const totalPurchases = rows.reduce((sum, r) => sum + r.totalPurchases, 0);
  const totalCommissions = rows.reduce((sum, r) => sum + r.totalCommissions, 0);
  const rowsWithPurchases = rows.filter((r) => r.totalPurchases > 0);
  const avgPercent =
    rowsWithPurchases.length > 0
      ? Math.round(
          (rowsWithPurchases.reduce(
            (sum, r) => sum + (r.commissionPercentage || 0),
            0
          ) /
            rowsWithPurchases.length) *
            100
        ) / 100
      : 0;

  return {
    rows,
    summary: {
      totalPurchases: Math.round(totalPurchases * 100) / 100,
      totalCommissions: Math.round(totalCommissions * 100) / 100,
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
      totalPurchases: 0,
      totalCommissions: 0,
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
