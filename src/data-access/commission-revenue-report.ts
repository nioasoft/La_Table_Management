import { database } from "@/db";
import {
  franchisee,
  brand,
  uploadedFile,
  franchiseeBkmvYear,
  type BkmvProcessingResult,
} from "@/db/schema";
import { eq, and, inArray, gte, lte, isNotNull } from "drizzle-orm";
import { normalizeName } from "@/lib/franchisee-matcher";
import { getSmallSupplierNamesSet } from "@/data-access/bkmvSmallSuppliers";

// ============================================================================
// TYPES
// ============================================================================

export interface CommissionRevenueReportFilters {
  year: number;
  startMonth: number; // 1-12
  endMonth: number; // 1-12
  brandId?: string;
}

export interface SupplierBreakdownEntry {
  supplierName: string;
  supplierId: string | null;
  amount: number;
  transactionCount: number;
  isSmallSupplier: boolean;
}

export interface RevenueBreakdownEntry {
  month: string; // "YYYY-MM"
  amount: number;
}

export interface CommissionRevenueRow {
  franchiseeId: string;
  name: string;
  code: string;
  brandName: string;
  totalRevenue: number; // Revenue from BKMV files (turnover)
  totalSupplierPurchases: number; // Purchases from BKMVDATA (matched + small suppliers)
  supplierPurchasesPercentage: number | null; // null when revenue is 0
  supplierBreakdown: SupplierBreakdownEntry[];
  revenueBreakdown: RevenueBreakdownEntry[];
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
  startMonth: number;
  endMonth: number;
  brandId: string | null;
  brandName: string | null;
  generatedAt: string;
}

// ============================================================================
// HELPERS
// ============================================================================

function getDateRange(
  year: number,
  startMonth: number,
  endMonth: number
): { startDate: string; endDate: string; months: string[] } {
  const formatLocalDate = (date: Date) => {
    const y = date.getFullYear();
    const m = String(date.getMonth() + 1).padStart(2, "0");
    const d = String(date.getDate()).padStart(2, "0");
    return `${y}-${m}-${d}`;
  };

  // startMonth/endMonth are 1-12
  const start = new Date(year, startMonth - 1, 1);
  const end = new Date(year, endMonth, 0); // last day of endMonth

  const months: string[] = [];
  for (let m = startMonth; m <= endMonth; m++) {
    months.push(`${year}-${String(m).padStart(2, "0")}`);
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
 * Supplier Purchases: from franchisee_bkmv_year.monthlyBreakdown (matched suppliers + small suppliers)
 */
export async function getCommissionRevenueReport(
  filters: CommissionRevenueReportFilters
): Promise<CommissionRevenueReport> {
  const { year, startMonth, endMonth, brandId } = filters;
  const { startDate, endDate, months } = getDateRange(year, startMonth, endMonth);

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
  // Also collect per-month detail for breakdown
  const revenueMap = new Map<string, number>();
  const revenueDetailMap = new Map<string, Map<string, number>>();

  for (const file of bkmvFiles) {
    const result = file.processingResult as BkmvProcessingResult | null;
    if (!result?.revenueMonthlyBreakdown) continue;

    for (const [month, amount] of Object.entries(result.revenueMonthlyBreakdown)) {
      if (months.includes(month)) {
        const fId = file.franchiseeId!;
        const prev = revenueMap.get(fId) || 0;
        revenueMap.set(fId, prev + (amount as number));

        // Collect per-month detail
        if (!revenueDetailMap.has(fId)) {
          revenueDetailMap.set(fId, new Map());
        }
        const monthMap = revenueDetailMap.get(fId)!;
        monthMap.set(month, (monthMap.get(month) || 0) + (amount as number));
      }
    }
  }

  // ---- BKMVDATA: Get supplier purchases from unified structure ----
  const startYear = parseInt(startDate.slice(0, 4), 10);
  const endYear = parseInt(endDate.slice(0, 4), 10);

  const yearRecords = await database
    .select({
      franchiseeId: franchiseeBkmvYear.franchiseeId,
      monthlyBreakdown: franchiseeBkmvYear.monthlyBreakdown,
    })
    .from(franchiseeBkmvYear)
    .where(
      and(
        gte(franchiseeBkmvYear.year, startYear),
        lte(franchiseeBkmvYear.year, endYear)
      )
    );

  // Get small supplier names set for matching
  const smallSupplierNames = await getSmallSupplierNamesSet();

  // Build purchases map from BKMVDATA
  // Also collect per-supplier detail for breakdown
  const purchasesMap = new Map<string, number>();
  const purchasesDetailMap = new Map<string, Map<string, SupplierBreakdownEntry>>();

  type MonthlyBreakdownEntry = {
    supplierId: string | null;
    supplierName: string;
    amount: number;
    transactionCount: number;
  };

  for (const record of yearRecords) {
    const breakdown = record.monthlyBreakdown as Record<string, MonthlyBreakdownEntry[]> | null;
    if (!breakdown) continue;

    for (const [month, entries] of Object.entries(breakdown)) {
      if (!months.includes(month)) continue;

      for (const entry of entries) {
        const isMatched = entry.supplierId !== null;
        const isSmall = !isMatched && smallSupplierNames.has(normalizeName(entry.supplierName));

        if (!isMatched && !isSmall) continue;

        const fId = record.franchiseeId;
        const prev = purchasesMap.get(fId) || 0;
        purchasesMap.set(fId, prev + entry.amount);

        // Collect per-supplier detail
        if (!purchasesDetailMap.has(fId)) {
          purchasesDetailMap.set(fId, new Map());
        }
        const supplierMap = purchasesDetailMap.get(fId)!;
        const key = entry.supplierName;
        const existing = supplierMap.get(key);
        if (existing) {
          existing.amount += entry.amount;
          existing.transactionCount += entry.transactionCount;
        } else {
          supplierMap.set(key, {
            supplierName: entry.supplierName,
            supplierId: entry.supplierId,
            amount: entry.amount,
            transactionCount: entry.transactionCount,
            isSmallSupplier: isSmall,
          });
        }
      }
    }
  }

  // ---- JOIN: Merge revenue and purchases maps ----
  const allFranchiseeIds = new Set<string>([
    ...revenueMap.keys(),
    ...purchasesMap.keys(),
  ]);

  if (allFranchiseeIds.size === 0) {
    return emptyReport(year, startMonth, endMonth, brandId, brandInfo);
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
    if (brandId && f.brandId !== brandId) continue;

    const revenue = revenueMap.get(f.id) || 0;
    const supplierPurchases = purchasesMap.get(f.id) || 0;

    if (revenue === 0 && supplierPurchases === 0) continue;

    let supplierPurchasesPercentage: number | null;
    if (revenue > 0) {
      supplierPurchasesPercentage =
        Math.round((supplierPurchases / revenue) * 100 * 100) / 100;
    } else {
      supplierPurchasesPercentage = null;
    }

    // Build supplier breakdown sorted by amount desc
    const supplierDetail = purchasesDetailMap.get(f.id);
    const supplierBreakdown: SupplierBreakdownEntry[] = supplierDetail
      ? Array.from(supplierDetail.values())
          .map((e) => ({
            ...e,
            amount: Math.round(e.amount * 100) / 100,
          }))
          .sort((a, b) => b.amount - a.amount)
      : [];

    // Build revenue monthly breakdown sorted by month
    const revenueDetail = revenueDetailMap.get(f.id);
    const revenueBreakdown: RevenueBreakdownEntry[] = revenueDetail
      ? Array.from(revenueDetail.entries())
          .map(([month, amount]) => ({
            month,
            amount: Math.round(amount * 100) / 100,
          }))
          .sort((a, b) => a.month.localeCompare(b.month))
      : [];

    rows.push({
      franchiseeId: f.id,
      name: f.name,
      code: f.code,
      brandName: f.brandId ? brandNames.get(f.brandId) || "" : "",
      totalRevenue: Math.round(revenue * 100) / 100,
      totalSupplierPurchases: Math.round(supplierPurchases * 100) / 100,
      supplierPurchasesPercentage,
      supplierBreakdown,
      revenueBreakdown,
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
    startMonth,
    endMonth,
    brandId: brandId || null,
    brandName: brandInfo?.nameHe || null,
    generatedAt: new Date().toISOString(),
  };
}

function emptyReport(
  year: number,
  startMonth: number,
  endMonth: number,
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
    startMonth,
    endMonth,
    brandId: brandId || null,
    brandName: brandInfo?.nameHe || null,
    generatedAt: new Date().toISOString(),
  };
}
