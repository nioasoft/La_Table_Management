/**
 * Data access functions for supplier files report
 *
 * This report shows uploaded supplier files with their processing results,
 * calculated commissions, and download links.
 */

import { database } from "@/db";
import {
  supplierFileUpload,
  supplier,
  brand,
  user,
  franchisee,
  type SupplierFileProcessingResult,
} from "@/db/schema";
import { eq, and, sql, desc, gte, lte, inArray } from "drizzle-orm";
import { unstable_cache } from "next/cache";

// ============================================================================
// TYPES
// ============================================================================

export interface SupplierFileEntry {
  id: string;
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  fileName: string;
  fileUrl: string | null;
  fileSize: number | null;
  periodStartDate: string | null;
  periodEndDate: string | null;
  processingStatus: string;
  totalGrossAmount: number;
  totalNetAmount: number;
  commissionRate: number | null;
  commissionType: string | null;
  calculatedCommission: number;
  preCalculatedCommission: number | null;
  franchiseeCount: number;
  transactionCount: number;
  uploadedAt: Date;
  uploadedBy: string | null;
  uploadedByName: string | null;
  reviewedAt: Date | null;
  reviewedByName: string | null;
  reviewNotes: string | null;
}

export interface SupplierFranchiseeEntry {
  franchiseeId: string;
  franchiseeName: string;
  brandId: string;
  brandName: string;
  grossAmount: number;
  netAmount: number;
  commission: number;
}

export interface SupplierFileSummary {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  fileCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommission: number;
  franchisees: SupplierFranchiseeEntry[];
}

export interface SupplierFilesReport {
  summary: {
    totalFiles: number;
    totalGrossAmount: number;
    totalNetAmount: number;
    totalCalculatedCommission: number;
    supplierCount: number;
    periodRange: {
      startDate: string | null;
      endDate: string | null;
    };
    generatedAt: string;
  };
  bySupplier: SupplierFileSummary[];
  files: SupplierFileEntry[];
}

export interface SupplierFilesFilters {
  supplierId?: string;
  brandId?: string;
  startDate?: string;
  endDate?: string;
  status?: string;
}

export interface FilterOption {
  id: string;
  name?: string;
  nameHe?: string;
  code?: string;
}

export interface SupplierFilesFilterOptions {
  suppliers: FilterOption[];
  brands: FilterOption[];
  statuses: { value: string; label: string }[];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Calculate commission from processing result
 */
function calculateCommission(
  processingResult: SupplierFileProcessingResult | null,
  commissionRate: number | null,
  commissionType: string | null
): { calculated: number; preCalculated: number | null } {
  if (!processingResult) {
    return { calculated: 0, preCalculated: null };
  }

  // Check for pre-calculated commission in franchisee matches
  let preCalculatedTotal = 0;
  let hasPreCalculated = false;

  if (processingResult.franchiseeMatches) {
    for (const match of processingResult.franchiseeMatches) {
      // Check if match has preCalculatedCommission field
      const matchAny = match as Record<string, unknown>;
      if (typeof matchAny.preCalculatedCommission === "number") {
        preCalculatedTotal += matchAny.preCalculatedCommission;
        hasPreCalculated = true;
      }
    }
  }

  // Calculate based on rate and type
  let calculated = 0;
  if (commissionRate && commissionType === "percentage") {
    calculated = processingResult.totalNetAmount * (commissionRate / 100);
  } else if (commissionRate && commissionType === "per_item") {
    calculated = processingResult.processedRows * commissionRate;
  }

  return {
    calculated: Math.trunc(calculated * 100) / 100,
    preCalculated: hasPreCalculated ? Math.trunc(preCalculatedTotal * 100) / 100 : null,
  };
}

/**
 * Get status label in Hebrew
 */
export function getStatusLabel(status: string): string {
  const labels: Record<string, string> = {
    pending: "ממתין",
    processing: "בעיבוד",
    auto_approved: "אושר אוטומטית",
    needs_review: "דורש בדיקה",
    approved: "מאושר",
    rejected: "נדחה",
  };
  return labels[status] || status;
}

// ============================================================================
// DATA ACCESS FUNCTIONS
// ============================================================================

/**
 * Get supplier files report with filtering
 */
export async function getSupplierFilesReport(
  filters: SupplierFilesFilters = {}
): Promise<SupplierFilesReport> {
  // Build conditions array
  const conditions: ReturnType<typeof eq>[] = [];

  if (filters.status) {
    conditions.push(eq(supplierFileUpload.processingStatus, filters.status as "pending" | "processing" | "auto_approved" | "needs_review" | "approved" | "rejected"));
  }

  // Get all supplier files with related data
  const filesQuery = database
    .select({
      // File data
      id: supplierFileUpload.id,
      supplierId: supplierFileUpload.supplierId,
      originalFileName: supplierFileUpload.originalFileName,
      fileUrl: supplierFileUpload.fileUrl,
      fileSize: supplierFileUpload.fileSize,
      processingStatus: supplierFileUpload.processingStatus,
      processingResult: supplierFileUpload.processingResult,
      periodStartDate: supplierFileUpload.periodStartDate,
      periodEndDate: supplierFileUpload.periodEndDate,
      createdAt: supplierFileUpload.createdAt,
      createdBy: supplierFileUpload.createdBy,
      reviewedAt: supplierFileUpload.reviewedAt,
      reviewNotes: supplierFileUpload.reviewNotes,
      // Supplier data
      supplierName: supplier.name,
      supplierCode: supplier.code,
      commissionRate: supplier.defaultCommissionRate,
      commissionType: supplier.commissionType,
      // User data
      uploadedByName: user.name,
    })
    .from(supplierFileUpload)
    .innerJoin(supplier, eq(supplierFileUpload.supplierId, supplier.id))
    .leftJoin(user, eq(supplierFileUpload.createdBy, user.id));

  // Apply date filters using raw SQL
  let finalQuery = filesQuery;

  // Use overlap logic: show files whose period overlaps with the filter range
  // Overlap condition: file.endDate >= filter.startDate AND file.startDate <= filter.endDate
  if (filters.startDate) {
    finalQuery = finalQuery.where(
      sql`${supplierFileUpload.periodEndDate} >= ${filters.startDate}`
    ) as typeof filesQuery;
  }

  if (filters.endDate) {
    finalQuery = finalQuery.where(
      sql`${supplierFileUpload.periodStartDate} <= ${filters.endDate}`
    ) as typeof filesQuery;
  }

  if (filters.supplierId) {
    finalQuery = finalQuery.where(
      eq(supplierFileUpload.supplierId, filters.supplierId)
    ) as typeof filesQuery;
  }

  if (filters.status) {
    finalQuery = finalQuery.where(
      eq(supplierFileUpload.processingStatus, filters.status as "pending" | "processing" | "auto_approved" | "needs_review" | "approved" | "rejected")
    ) as typeof filesQuery;
  }

  // Note: Brand filtering is done at franchisee-match level, not supplier level.
  // This allows filtering by "שונות" brand which contains franchisees like "דון פדרו"
  // that appear in supplier files but aren't supplier-brand associations.

  const rawFiles = await finalQuery.orderBy(desc(supplierFileUpload.createdAt));

  // Deduplicate: keep only the latest file per supplier
  const supplierLatestFile = new Map<string, typeof rawFiles[0]>();
  for (const file of rawFiles) {
    const existing = supplierLatestFile.get(file.supplierId);
    if (!existing || file.createdAt > existing.createdAt) {
      supplierLatestFile.set(file.supplierId, file);
    }
  }
  const dedupedFiles = Array.from(supplierLatestFile.values());

  // Load franchisee data with brand names for display and filtering
  const franchiseesData = await database
    .select({
      id: franchisee.id,
      name: franchisee.name,
      brandId: franchisee.brandId,
      brandName: brand.nameHe,
    })
    .from(franchisee)
    .innerJoin(brand, eq(franchisee.brandId, brand.id))
    .where(eq(franchisee.isActive, true));

  const franchiseeInfoMap = new Map(
    franchiseesData.map((f) => [f.id, { name: f.name, brandId: f.brandId, brandName: f.brandName }])
  );

  // For brand filtering, create a simple brandId map
  const franchiseeBrandMap: Map<string, string> | null = filters.brandId
    ? new Map(franchiseesData.map((f) => [f.id, f.brandId]))
    : null;

  // Process files and calculate commissions
  const filesUnfiltered: SupplierFileEntry[] = dedupedFiles.map((file) => {
    const processingResult = file.processingResult as SupplierFileProcessingResult | null;
    const commissionRate = file.commissionRate ? parseFloat(file.commissionRate) : null;

    // When brand filter is active, calculate amounts only from franchisees of that brand
    let totalGrossAmount = processingResult?.totalGrossAmount || 0;
    let totalNetAmount = processingResult?.totalNetAmount || 0;
    let franchiseeCount = processingResult?.matchStats?.total || 0;

    if (filters.brandId && franchiseeBrandMap && processingResult?.franchiseeMatches) {
      const filteredMatches = processingResult.franchiseeMatches.filter(
        (match) =>
          match.matchedFranchiseeId &&
          franchiseeBrandMap!.get(match.matchedFranchiseeId) === filters.brandId
      );

      totalGrossAmount = filteredMatches.reduce((sum, m) => sum + (m.grossAmount || 0), 0);
      totalNetAmount = filteredMatches.reduce((sum, m) => sum + (m.netAmount || 0), 0);
      franchiseeCount = filteredMatches.length;
    }

    // Calculate commission based on filtered amounts when brand filter is active
    let calculated = 0;
    if (commissionRate && file.commissionType === "percentage") {
      calculated = totalNetAmount * (commissionRate / 100);
    } else if (commissionRate && file.commissionType === "per_item") {
      // For per_item, we need to count filtered transactions
      calculated = (filters.brandId && franchiseeBrandMap ? franchiseeCount : (processingResult?.processedRows || 0)) * commissionRate;
    }
    calculated = Math.trunc(calculated * 100) / 100;

    // Check for pre-calculated commission in franchisee matches (filtered by brand if needed)
    let preCalculated: number | null = null;
    if (processingResult?.franchiseeMatches) {
      const matchesToUse = filters.brandId && franchiseeBrandMap
        ? processingResult.franchiseeMatches.filter(
            (match) =>
              match.matchedFranchiseeId &&
              franchiseeBrandMap!.get(match.matchedFranchiseeId) === filters.brandId
          )
        : processingResult.franchiseeMatches;

      let preCalculatedTotal = 0;
      let hasPreCalculated = false;
      for (const match of matchesToUse) {
        const matchAny = match as Record<string, unknown>;
        if (typeof matchAny.preCalculatedCommission === "number") {
          preCalculatedTotal += matchAny.preCalculatedCommission;
          hasPreCalculated = true;
        }
      }
      preCalculated = hasPreCalculated ? Math.trunc(preCalculatedTotal * 100) / 100 : null;
    }

    return {
      id: file.id,
      supplierId: file.supplierId,
      supplierName: file.supplierName,
      supplierCode: file.supplierCode,
      fileName: file.originalFileName,
      fileUrl: file.fileUrl,
      fileSize: file.fileSize,
      periodStartDate: file.periodStartDate,
      periodEndDate: file.periodEndDate,
      processingStatus: file.processingStatus,
      totalGrossAmount,
      totalNetAmount,
      commissionRate,
      commissionType: file.commissionType,
      calculatedCommission: preCalculated !== null ? preCalculated : calculated,
      preCalculatedCommission: preCalculated,
      franchiseeCount,
      transactionCount: processingResult?.processedRows || 0,
      uploadedAt: file.createdAt,
      uploadedBy: file.createdBy,
      uploadedByName: file.uploadedByName,
      reviewedAt: file.reviewedAt,
      reviewedByName: null, // Would need another join
      reviewNotes: file.reviewNotes,
    };
  });

  // When brand filter is active, exclude files that have no matches for that brand
  const files = filters.brandId
    ? filesUnfiltered.filter((f) => f.franchiseeCount > 0)
    : filesUnfiltered;

  // Calculate summary by supplier with franchisee details
  // We need to go back to raw files to get franchisee breakdown
  const supplierMap = new Map<string, {
    supplierId: string;
    supplierName: string;
    supplierCode: string;
    fileCount: number;
    totalGrossAmount: number;
    totalNetAmount: number;
    totalCommission: number;
    franchiseeMap: Map<string, SupplierFranchiseeEntry>;
  }>();

  for (const file of dedupedFiles) {
    const fileEntry = files.find((f) => f.id === file.id);
    if (!fileEntry) continue;

    const processingResult = file.processingResult as SupplierFileProcessingResult | null;

    let existing = supplierMap.get(file.supplierId);
    if (!existing) {
      existing = {
        supplierId: file.supplierId,
        supplierName: file.supplierName,
        supplierCode: file.supplierCode,
        fileCount: 0,
        totalGrossAmount: 0,
        totalNetAmount: 0,
        totalCommission: 0,
        franchiseeMap: new Map(),
      };
      supplierMap.set(file.supplierId, existing);
    }

    existing.fileCount++;
    existing.totalGrossAmount += fileEntry.totalGrossAmount;
    existing.totalNetAmount += fileEntry.totalNetAmount;
    existing.totalCommission += fileEntry.calculatedCommission;

    // Extract franchisee details from processing result
    // Get supplier commission info for calculating per-franchisee commission
    const commissionRate = file.commissionRate ? parseFloat(file.commissionRate) : null;
    const commissionType = file.commissionType;

    if (processingResult?.franchiseeMatches) {
      for (const match of processingResult.franchiseeMatches) {
        if (!match.matchedFranchiseeId) continue;
        if (match.matchType === "blacklisted") continue;

        // Apply brand filter at franchisee level
        if (filters.brandId && franchiseeBrandMap) {
          if (franchiseeBrandMap.get(match.matchedFranchiseeId) !== filters.brandId) continue;
        }

        const franchiseeInfo = franchiseeInfoMap.get(match.matchedFranchiseeId);
        if (!franchiseeInfo) continue;

        // Calculate commission for this franchisee match
        const matchAny = match as Record<string, unknown>;
        let matchCommission = 0;
        if (typeof matchAny.preCalculatedCommission === "number") {
          // Commission from file (for suppliers like MADAG, AVRAHAMI, etc.)
          matchCommission = matchAny.preCalculatedCommission;
        } else if (commissionRate && commissionType === "percentage") {
          // Fixed commission rate
          matchCommission = (match.netAmount || 0) * (commissionRate / 100);
        }
        matchCommission = Math.trunc(matchCommission * 100) / 100;

        const existingFranchisee = existing.franchiseeMap.get(match.matchedFranchiseeId);
        if (existingFranchisee) {
          existingFranchisee.grossAmount += match.grossAmount || 0;
          existingFranchisee.netAmount += match.netAmount || 0;
          existingFranchisee.commission += matchCommission;
        } else {
          existing.franchiseeMap.set(match.matchedFranchiseeId, {
            franchiseeId: match.matchedFranchiseeId,
            franchiseeName: franchiseeInfo.name,
            brandId: franchiseeInfo.brandId,
            brandName: franchiseeInfo.brandName,
            grossAmount: match.grossAmount || 0,
            netAmount: match.netAmount || 0,
            commission: matchCommission,
          });
        }
      }
    }
  }

  const bySupplier: SupplierFileSummary[] = Array.from(supplierMap.values())
    .map((s) => ({
      supplierId: s.supplierId,
      supplierName: s.supplierName,
      supplierCode: s.supplierCode,
      fileCount: s.fileCount,
      totalGrossAmount: s.totalGrossAmount,
      totalNetAmount: s.totalNetAmount,
      totalCommission: s.totalCommission,
      franchisees: Array.from(s.franchiseeMap.values()).sort(
        (a, b) => b.netAmount - a.netAmount
      ),
    }))
    .sort((a, b) => b.totalCommission - a.totalCommission);

  // Calculate overall summary
  const totalGrossAmount = files.reduce((sum, f) => sum + f.totalGrossAmount, 0);
  const totalNetAmount = files.reduce((sum, f) => sum + f.totalNetAmount, 0);
  const totalCalculatedCommission = files.reduce((sum, f) => sum + f.calculatedCommission, 0);

  // Get period range
  const validDates = files
    .filter((f) => f.periodStartDate && f.periodEndDate)
    .flatMap((f) => [f.periodStartDate!, f.periodEndDate!])
    .sort();

  return {
    summary: {
      totalFiles: files.length,
      totalGrossAmount: Math.trunc(totalGrossAmount * 100) / 100,
      totalNetAmount: Math.trunc(totalNetAmount * 100) / 100,
      totalCalculatedCommission: Math.trunc(totalCalculatedCommission * 100) / 100,
      supplierCount: supplierMap.size,
      periodRange: {
        startDate: validDates[0] || null,
        endDate: validDates[validDates.length - 1] || null,
      },
      generatedAt: new Date().toISOString(),
    },
    bySupplier,
    files,
  };
}

/**
 * Get filter options for supplier files report
 */
export const getSupplierFilesFilterOptions = unstable_cache(
  async (): Promise<SupplierFilesFilterOptions> => {
    // Get all active suppliers that have files
    const suppliers = await database
      .selectDistinct({
        id: supplier.id,
        name: supplier.name,
        code: supplier.code,
      })
      .from(supplier)
      .innerJoin(supplierFileUpload, eq(supplier.id, supplierFileUpload.supplierId))
      .where(eq(supplier.isActive, true))
      .orderBy(supplier.name);

    // Get all brands
    const brands = await database
      .select({
        id: brand.id,
        nameHe: brand.nameHe,
        nameEn: brand.nameEn,
      })
      .from(brand)
      .orderBy(brand.nameHe);

    // Static status options
    const statuses = [
      { value: "pending", label: "ממתין" },
      { value: "processing", label: "בעיבוד" },
      { value: "auto_approved", label: "אושר אוטומטית" },
      { value: "needs_review", label: "דורש בדיקה" },
      { value: "approved", label: "מאושר" },
      { value: "rejected", label: "נדחה" },
    ];

    return {
      suppliers: suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
      })),
      brands: brands.map((b) => ({
        id: b.id,
        name: b.nameEn || undefined,
        nameHe: b.nameHe,
      })),
      statuses,
    };
  },
  ["supplier-files-filter-options"],
  { revalidate: 300 } // Cache for 5 minutes
);

/**
 * Get a single supplier file by ID (for download validation)
 */
export async function getSupplierFileById(fileId: string): Promise<{
  id: string;
  fileUrl: string | null;
  fileName: string;
  supplierId: string;
  supplierName: string;
} | null> {
  const result = await database
    .select({
      id: supplierFileUpload.id,
      fileUrl: supplierFileUpload.fileUrl,
      fileName: supplierFileUpload.originalFileName,
      supplierId: supplierFileUpload.supplierId,
      supplierName: supplier.name,
    })
    .from(supplierFileUpload)
    .innerJoin(supplier, eq(supplierFileUpload.supplierId, supplier.id))
    .where(eq(supplierFileUpload.id, fileId))
    .limit(1);

  return result[0] || null;
}

// ============================================================================
// FRANCHISEE BREAKDOWN REPORT
// ============================================================================

export interface FranchiseeSupplierEntry {
  supplierId: string;
  supplierName: string;
  fileId: string;
  fileName: string;
  originalName: string;
  grossAmount: number;
  netAmount: number;
  matchType: string;
  createdAt: Date; // Added for deduplication - tracks which file is newest
  commission: number;
}

export interface FranchiseeBreakdownEntry {
  franchiseeId: string;
  franchiseeName: string;
  brandId: string;
  brandName: string;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommission: number;
  supplierCount: number;
  suppliers: FranchiseeSupplierEntry[];
}

export interface FranchiseeBreakdownReport {
  summary: {
    totalFranchisees: number;
    totalGrossAmount: number;
    totalNetAmount: number;
    totalFiles: number;
    generatedAt: string;
  };
  franchisees: FranchiseeBreakdownEntry[];
}

export interface FranchiseeBreakdownFilters {
  startDate?: string;
  endDate?: string;
  brandId?: string;
}

/**
 * Get supplier files data grouped by franchisee
 * Shows which suppliers reported amounts for each franchisee
 */
export async function getFranchiseeBreakdownReport(
  filters: FranchiseeBreakdownFilters = {}
): Promise<FranchiseeBreakdownReport> {
  // Build conditions array
  const conditions: ReturnType<typeof eq>[] = [
    inArray(supplierFileUpload.processingStatus, ["approved", "auto_approved"]),
  ];

  // Apply date filters using overlap logic
  // Overlap condition: file.endDate >= filter.startDate AND file.startDate <= filter.endDate
  if (filters.startDate) {
    conditions.push(gte(supplierFileUpload.periodEndDate, filters.startDate));
  }

  if (filters.endDate) {
    conditions.push(lte(supplierFileUpload.periodStartDate, filters.endDate));
  }

  // Note: Brand filtering is done at franchisee-match level below, not at supplier level.
  // This allows filtering by "שונות" brand which contains franchisees like "דון פדרו"
  // that appear in supplier files but aren't supplier-brand associations.

  const rawFiles = await database
    .select({
      id: supplierFileUpload.id,
      supplierId: supplierFileUpload.supplierId,
      originalFileName: supplierFileUpload.originalFileName,
      processingResult: supplierFileUpload.processingResult,
      periodStartDate: supplierFileUpload.periodStartDate,
      periodEndDate: supplierFileUpload.periodEndDate,
      createdAt: supplierFileUpload.createdAt, // Added for deduplication
      supplierName: supplier.name,
      commissionRate: supplier.defaultCommissionRate,
      commissionType: supplier.commissionType,
    })
    .from(supplierFileUpload)
    .innerJoin(supplier, eq(supplierFileUpload.supplierId, supplier.id))
    .where(and(...conditions));

  // Get all franchisees with their brand info
  const franchiseesData = await database
    .select({
      id: franchisee.id,
      name: franchisee.name,
      brandId: franchisee.brandId,
      brandName: brand.nameHe,
    })
    .from(franchisee)
    .innerJoin(brand, eq(franchisee.brandId, brand.id))
    .where(eq(franchisee.isActive, true));

  const franchiseeMap = new Map(
    franchiseesData.map((f) => [f.id, f])
  );

  // Group data by franchisee
  const franchiseeDataMap = new Map<string, {
    franchiseeId: string;
    franchiseeName: string;
    brandId: string;
    brandName: string;
    suppliers: Map<string, FranchiseeSupplierEntry>;
  }>();

  let totalFiles = 0;

  for (const file of rawFiles) {
    const processingResult = file.processingResult as SupplierFileProcessingResult | null;
    if (!processingResult?.franchiseeMatches) continue;

    totalFiles++;

    // Get supplier commission info for calculating per-franchisee commission
    const commissionRate = file.commissionRate ? parseFloat(file.commissionRate) : null;
    const commissionType = file.commissionType;

    for (const match of processingResult.franchiseeMatches) {
      if (!match.matchedFranchiseeId) continue;

      // Skip blacklisted entries
      if (match.matchType === "blacklisted") continue;

      const franchiseeInfo = franchiseeMap.get(match.matchedFranchiseeId);
      if (!franchiseeInfo) continue;

      // Apply brand filter at franchisee level too
      if (filters.brandId && franchiseeInfo.brandId !== filters.brandId) continue;

      // Calculate commission for this match
      const matchAny = match as Record<string, unknown>;
      let matchCommission = 0;
      if (typeof matchAny.preCalculatedCommission === "number") {
        // Commission from file (for suppliers like MADAG, AVRAHAMI, etc.)
        matchCommission = matchAny.preCalculatedCommission;
      } else if (commissionRate && commissionType === "percentage") {
        // Fixed commission rate
        matchCommission = (match.netAmount || 0) * (commissionRate / 100);
      }
      matchCommission = Math.trunc(matchCommission * 100) / 100;

      let franchiseeData = franchiseeDataMap.get(match.matchedFranchiseeId);
      if (!franchiseeData) {
        franchiseeData = {
          franchiseeId: match.matchedFranchiseeId,
          franchiseeName: franchiseeInfo.name,
          brandId: franchiseeInfo.brandId,
          brandName: franchiseeInfo.brandName,
          suppliers: new Map(),
        };
        franchiseeDataMap.set(match.matchedFranchiseeId, franchiseeData);
      }

      // Add supplier entry - group by supplier only, keep only the LATEST file per supplier
      const supplierKey = file.supplierId;
      const existingSupplier = franchiseeData.suppliers.get(supplierKey);

      if (existingSupplier) {
        // Same file - aggregate amounts (same franchisee listed twice in one file)
        if (existingSupplier.fileId === file.id) {
          existingSupplier.grossAmount += match.grossAmount || 0;
          existingSupplier.netAmount += match.netAmount || 0;
          existingSupplier.commission += matchCommission;
          continue;
        }
        // Different file - keep only the newer one
        if (file.createdAt <= existingSupplier.createdAt) {
          continue; // Skip - we already have a newer file
        }
        // This file is newer - will replace below
      }

      franchiseeData.suppliers.set(supplierKey, {
        supplierId: file.supplierId,
        supplierName: file.supplierName,
        fileId: file.id,
        fileName: file.originalFileName,
        originalName: match.originalName,
        grossAmount: match.grossAmount || 0,
        netAmount: match.netAmount || 0,
        matchType: match.matchType,
        createdAt: file.createdAt, // Track for comparison
        commission: matchCommission,
      });
    }
  }

  // Convert to array and sort by total amount
  // Calculate totals from supplier entries (which only contain latest file per supplier)
  const franchisees: FranchiseeBreakdownEntry[] = Array.from(
    franchiseeDataMap.values()
  )
    .map((data) => {
      const suppliersList = Array.from(data.suppliers.values());
      const totalGross = suppliersList.reduce((sum, s) => sum + s.grossAmount, 0);
      const totalNet = suppliersList.reduce((sum, s) => sum + s.netAmount, 0);
      const totalCommission = suppliersList.reduce((sum, s) => sum + s.commission, 0);
      return {
        franchiseeId: data.franchiseeId,
        franchiseeName: data.franchiseeName,
        brandId: data.brandId,
        brandName: data.brandName,
        totalGrossAmount: Math.trunc(totalGross * 100) / 100,
        totalNetAmount: Math.trunc(totalNet * 100) / 100,
        totalCommission: Math.trunc(totalCommission * 100) / 100,
        supplierCount: data.suppliers.size,
        suppliers: suppliersList.sort((a, b) => b.netAmount - a.netAmount),
      };
    })
    .sort((a, b) => b.totalNetAmount - a.totalNetAmount);

  // Calculate summary
  const totalGrossAmount = franchisees.reduce(
    (sum, f) => sum + f.totalGrossAmount,
    0
  );
  const totalNetAmount = franchisees.reduce(
    (sum, f) => sum + f.totalNetAmount,
    0
  );

  return {
    summary: {
      totalFranchisees: franchisees.length,
      totalGrossAmount: Math.trunc(totalGrossAmount * 100) / 100,
      totalNetAmount: Math.trunc(totalNetAmount * 100) / 100,
      totalFiles,
      generatedAt: new Date().toISOString(),
    },
    franchisees,
  };
}
