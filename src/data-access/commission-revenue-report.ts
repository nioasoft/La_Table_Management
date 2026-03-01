import { database } from "@/db";
import {
  franchisee,
  brand,
  supplier,
  uploadedFile,
  franchiseeBkmvYear,
  type BkmvProcessingResult,
} from "@/db/schema";
import { eq, and, inArray, gte, lte, isNotNull, desc } from "drizzle-orm";
import { normalizeName, generateNameVariants } from "@/lib/franchisee-matcher";
import { getSmallSupplierNamesSet } from "@/data-access/bkmvSmallSuppliers";
import { getVatRateForDate } from "@/data-access/vatRates";
import { calculateNetFromGross, roundToTwoDecimals } from "@/lib/file-processor";

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
  amountBeforeVat: number;
  isVatExempt: boolean;
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
  totalSupplierPurchases: number; // Purchases from BKMVDATA (matched + small suppliers) - including VAT
  totalSupplierPurchasesBeforeVat: number; // Purchases excluding VAT
  supplierPurchasesPercentage: number | null; // null when revenue is 0 (including VAT)
  supplierPurchasesPercentageBeforeVat: number | null; // null when revenue is 0 (before VAT)
  supplierBreakdown: SupplierBreakdownEntry[];
  revenueBreakdown: RevenueBreakdownEntry[];
}

export interface CommissionRevenueReport {
  rows: CommissionRevenueRow[];
  summary: {
    totalRevenue: number;
    totalSupplierPurchases: number;
    totalSupplierPurchasesBeforeVat: number;
    avgPercent: number;
    avgPercentBeforeVat: number;
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
  // Only approved/auto_approved files, ordered by newest first so we can
  // deduplicate per franchisee (take only the latest file's revenue data)
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
        lte(uploadedFile.periodStartDate, endDate),
        gte(uploadedFile.periodEndDate, startDate),
        inArray(uploadedFile.processingStatus, ["approved", "auto_approved"])
      )
    )
    .orderBy(desc(uploadedFile.createdAt));

  // Aggregate revenue by franchiseeId from BKMV files
  // Per franchisee per month, only use the LATEST file (first encountered due to desc order)
  // This handles franchisees who upload monthly files separately instead of one quarterly file
  const revenueMap = new Map<string, number>();
  const revenueDetailMap = new Map<string, Map<string, number>>();
  const seenFranchiseeMonths = new Map<string, Set<string>>();

  for (const file of bkmvFiles) {
    const fId = file.franchiseeId!;
    const result = file.processingResult as BkmvProcessingResult | null;
    if (!result?.revenueMonthlyBreakdown) continue;

    if (!seenFranchiseeMonths.has(fId)) {
      seenFranchiseeMonths.set(fId, new Set());
    }
    const seenMonths = seenFranchiseeMonths.get(fId)!;

    for (const [month, amount] of Object.entries(result.revenueMonthlyBreakdown)) {
      // Only include months in requested range, and only the latest file per month
      if (months.includes(month) && !seenMonths.has(month)) {
        seenMonths.add(month);
        const prev = revenueMap.get(fId) || 0;
        revenueMap.set(fId, prev + (amount as number));

        // Collect per-month detail
        if (!revenueDetailMap.has(fId)) {
          revenueDetailMap.set(fId, new Map());
        }
        const monthMap = revenueDetailMap.get(fId)!;
        monthMap.set(month, (amount as number));
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

  // Build exact-match verification map: supplierId -> Set<nameVariant>
  // This lets us distinguish exact matches (confidence=1) from fuzzy matches
  // since the stored monthlyBreakdown only has supplierId without confidence
  const allSuppliers = await database
    .select({
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
      bkmvAliases: supplier.bkmvAliases,
      vatExempt: supplier.vatExempt,
    })
    .from(supplier);

  // Build vatExempt lookup map
  const supplierVatExemptMap = new Map<string, boolean>();
  for (const s of allSuppliers) {
    supplierVatExemptMap.set(s.id, s.vatExempt);
  }

  // Get VAT rate for the period
  const periodDate = new Date(year, startMonth - 1, 1);
  const vatRate = await getVatRateForDate(periodDate);

  const supplierExactVariants = new Map<string, Set<string>>();
  for (const s of allSuppliers) {
    const variants = new Set<string>();
    for (const v of generateNameVariants(s.name)) variants.add(v);
    for (const v of generateNameVariants(s.code)) variants.add(v);
    if (s.bkmvAliases) {
      for (const alias of s.bkmvAliases as string[]) {
        for (const v of generateNameVariants(alias)) variants.add(v);
      }
    }
    supplierExactVariants.set(s.id, variants);
  }

  /**
   * Check if a BKMV entry name is an exact match for the assigned supplier.
   * Returns false for fuzzy matches (entries where supplierId was set based
   * on fuzzy similarity rather than exact name/alias/code match).
   */
  function isExactSupplierMatch(supplierId: string, bkmvName: string): boolean {
    const variants = supplierExactVariants.get(supplierId);
    if (!variants) return false;
    const nameVariants = generateNameVariants(bkmvName);
    return nameVariants.some((v) => variants.has(v));
  }

  // Build purchases map from BKMVDATA
  // Also collect per-supplier detail for breakdown
  const purchasesMap = new Map<string, number>();
  const purchasesBeforeVatMap = new Map<string, number>();
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
        // Only include exact matches (confidence=1) - not fuzzy matches
        const isExactMatch = entry.supplierId !== null &&
          isExactSupplierMatch(entry.supplierId, entry.supplierName);
        const isSmall = !isExactMatch && smallSupplierNames.has(normalizeName(entry.supplierName));

        if (!isExactMatch && !isSmall) continue;

        const fId = record.franchiseeId;
        const prev = purchasesMap.get(fId) || 0;
        purchasesMap.set(fId, prev + entry.amount);

        // Compute before-VAT amount
        const isVatExempt = entry.supplierId
          ? (supplierVatExemptMap.get(entry.supplierId) ?? false)
          : false;
        const amountBeforeVat = isVatExempt
          ? entry.amount
          : calculateNetFromGross(entry.amount, vatRate);
        const prevBeforeVat = purchasesBeforeVatMap.get(fId) || 0;
        purchasesBeforeVatMap.set(fId, prevBeforeVat + amountBeforeVat);

        // Collect per-supplier detail
        if (!purchasesDetailMap.has(fId)) {
          purchasesDetailMap.set(fId, new Map());
        }
        const supplierMap = purchasesDetailMap.get(fId)!;
        const key = entry.supplierName;
        const existing = supplierMap.get(key);
        if (existing) {
          existing.amount += entry.amount;
          existing.amountBeforeVat += amountBeforeVat;
          existing.transactionCount += entry.transactionCount;
        } else {
          supplierMap.set(key, {
            supplierName: entry.supplierName,
            supplierId: isExactMatch ? entry.supplierId : null,
            amount: entry.amount,
            amountBeforeVat,
            isVatExempt,
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
    const supplierPurchasesBeforeVat = purchasesBeforeVatMap.get(f.id) || 0;

    if (revenue === 0 && supplierPurchases === 0) continue;

    let supplierPurchasesPercentage: number | null;
    let supplierPurchasesPercentageBeforeVat: number | null;
    if (revenue > 0) {
      supplierPurchasesPercentage =
        Math.round((supplierPurchases / revenue) * 100 * 100) / 100;
      supplierPurchasesPercentageBeforeVat =
        Math.round((supplierPurchasesBeforeVat / revenue) * 100 * 100) / 100;
    } else {
      supplierPurchasesPercentage = null;
      supplierPurchasesPercentageBeforeVat = null;
    }

    // Build supplier breakdown sorted by amount desc
    const supplierDetail = purchasesDetailMap.get(f.id);
    const supplierBreakdown: SupplierBreakdownEntry[] = supplierDetail
      ? Array.from(supplierDetail.values())
          .map((e) => ({
            ...e,
            amount: roundToTwoDecimals(e.amount),
            amountBeforeVat: roundToTwoDecimals(e.amountBeforeVat),
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
      totalRevenue: roundToTwoDecimals(revenue),
      totalSupplierPurchases: roundToTwoDecimals(supplierPurchases),
      totalSupplierPurchasesBeforeVat: roundToTwoDecimals(supplierPurchasesBeforeVat),
      supplierPurchasesPercentage,
      supplierPurchasesPercentageBeforeVat,
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
  const totalSupplierPurchasesBeforeVat = rows.reduce(
    (sum, r) => sum + r.totalSupplierPurchasesBeforeVat,
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
  const avgPercentBeforeVat =
    rowsWithRevenue.length > 0
      ? Math.round(
          (rowsWithRevenue.reduce(
            (sum, r) => sum + (r.supplierPurchasesPercentageBeforeVat || 0),
            0
          ) /
            rowsWithRevenue.length) *
            100
        ) / 100
      : 0;

  return {
    rows,
    summary: {
      totalRevenue: roundToTwoDecimals(totalRevenue),
      totalSupplierPurchases: roundToTwoDecimals(totalSupplierPurchases),
      totalSupplierPurchasesBeforeVat: roundToTwoDecimals(totalSupplierPurchasesBeforeVat),
      avgPercent,
      avgPercentBeforeVat,
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
      totalSupplierPurchasesBeforeVat: 0,
      avgPercent: 0,
      avgPercentBeforeVat: 0,
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
