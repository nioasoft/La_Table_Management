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
  supplierBrand,
  brand,
  user,
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

export interface SupplierFileSummary {
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  fileCount: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  totalCommission: number;
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
    calculated: Math.round(calculated * 100) / 100,
    preCalculated: hasPreCalculated ? Math.round(preCalculatedTotal * 100) / 100 : null,
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

  if (filters.startDate) {
    finalQuery = finalQuery.where(
      sql`${supplierFileUpload.periodStartDate} >= ${filters.startDate}`
    ) as typeof filesQuery;
  }

  if (filters.endDate) {
    finalQuery = finalQuery.where(
      sql`${supplierFileUpload.periodEndDate} <= ${filters.endDate}`
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

  // Filter by brand if specified
  if (filters.brandId) {
    const supplierBrands = await database
      .select({ supplierId: supplierBrand.supplierId })
      .from(supplierBrand)
      .where(eq(supplierBrand.brandId, filters.brandId));
    const supplierIdsForBrand = supplierBrands.map((sb) => sb.supplierId);

    if (supplierIdsForBrand.length > 0) {
      finalQuery = finalQuery.where(
        inArray(supplierFileUpload.supplierId, supplierIdsForBrand)
      ) as typeof filesQuery;
    } else {
      // No suppliers associated with this brand - return empty result
      return {
        summary: {
          totalFiles: 0,
          totalGrossAmount: 0,
          totalNetAmount: 0,
          totalCalculatedCommission: 0,
          supplierCount: 0,
          periodRange: {
            startDate: null,
            endDate: null,
          },
          generatedAt: new Date().toISOString(),
        },
        bySupplier: [],
        files: [],
      };
    }
  }

  const rawFiles = await finalQuery.orderBy(desc(supplierFileUpload.createdAt));

  // Process files and calculate commissions
  const files: SupplierFileEntry[] = rawFiles.map((file) => {
    const processingResult = file.processingResult as SupplierFileProcessingResult | null;
    const commissionRate = file.commissionRate ? parseFloat(file.commissionRate) : null;
    const { calculated, preCalculated } = calculateCommission(
      processingResult,
      commissionRate,
      file.commissionType
    );

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
      totalGrossAmount: processingResult?.totalGrossAmount || 0,
      totalNetAmount: processingResult?.totalNetAmount || 0,
      commissionRate,
      commissionType: file.commissionType,
      calculatedCommission: preCalculated !== null ? preCalculated : calculated,
      preCalculatedCommission: preCalculated,
      franchiseeCount: processingResult?.matchStats?.total || 0,
      transactionCount: processingResult?.processedRows || 0,
      uploadedAt: file.createdAt,
      uploadedBy: file.createdBy,
      uploadedByName: file.uploadedByName,
      reviewedAt: file.reviewedAt,
      reviewedByName: null, // Would need another join
      reviewNotes: file.reviewNotes,
    };
  });

  // Calculate summary by supplier
  const supplierMap = new Map<string, SupplierFileSummary>();
  for (const file of files) {
    const existing = supplierMap.get(file.supplierId);
    if (existing) {
      existing.fileCount++;
      existing.totalGrossAmount += file.totalGrossAmount;
      existing.totalNetAmount += file.totalNetAmount;
      existing.totalCommission += file.calculatedCommission;
    } else {
      supplierMap.set(file.supplierId, {
        supplierId: file.supplierId,
        supplierName: file.supplierName,
        supplierCode: file.supplierCode,
        fileCount: 1,
        totalGrossAmount: file.totalGrossAmount,
        totalNetAmount: file.totalNetAmount,
        totalCommission: file.calculatedCommission,
      });
    }
  }

  const bySupplier = Array.from(supplierMap.values()).sort(
    (a, b) => b.totalCommission - a.totalCommission
  );

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
      totalGrossAmount: Math.round(totalGrossAmount * 100) / 100,
      totalNetAmount: Math.round(totalNetAmount * 100) / 100,
      totalCalculatedCommission: Math.round(totalCalculatedCommission * 100) / 100,
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
