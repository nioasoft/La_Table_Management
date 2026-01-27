/**
 * Data access functions for unified files report
 *
 * This module provides a unified view of all uploaded files in the system,
 * including both supplier files (from supplier_file_upload) and general
 * uploaded files (from uploaded_file table, e.g., BKMVDATA files).
 */

import { database } from "@/db";
import {
  uploadedFile,
  supplierFileUpload,
  supplier,
  franchisee,
  uploadLink,
  user,
  brand,
} from "@/db/schema";
import { eq, sql, desc, or, and } from "drizzle-orm";
import { unstable_cache } from "next/cache";

// ============================================================================
// TYPES
// ============================================================================

export type UnifiedFileSource = "supplier" | "uploaded";

export interface UnifiedFile {
  id: string;
  source: UnifiedFileSource;
  originalFileName: string;
  fileUrl: string | null;
  fileSize: number | null;
  processingStatus: string;
  createdAt: Date;
  periodStartDate: string | null;
  periodEndDate: string | null;
  entityType: "supplier" | "franchisee" | "upload_link" | null;
  entityId: string | null;
  entityName: string | null;
  uploadedByName: string | null;
  uploadedByEmail: string | null;
}

export interface UnifiedFileSummary {
  source: UnifiedFileSource;
  label: string;
  count: number;
  totalSize: number;
}

export interface UnifiedFilesReport {
  summary: {
    totalFiles: number;
    totalSize: number;
    supplierFiles: number;
    uploadedFiles: number;
    pendingReview: number;
    periodRange: {
      startDate: string | null;
      endDate: string | null;
    };
    generatedAt: string;
  };
  bySource: UnifiedFileSummary[];
  files: UnifiedFile[];
}

export interface UnifiedFilesFilters {
  source?: UnifiedFileSource;
  entityType?: "supplier" | "franchisee";
  status?: string;
  startDate?: string;
  endDate?: string;
}

export interface FilterOption {
  id: string;
  name?: string;
  nameHe?: string;
  code?: string;
}

export interface UnifiedFilesFilterOptions {
  sources: { value: UnifiedFileSource | "all"; label: string }[];
  entityTypes: { value: string; label: string }[];
  statuses: { value: string; label: string }[];
  suppliers: FilterOption[];
  franchisees: FilterOption[];
  brands: FilterOption[];
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

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

/**
 * Get source label in Hebrew
 */
export function getSourceLabel(source: UnifiedFileSource): string {
  return source === "supplier" ? "קובץ ספק" : "קובץ אחיד";
}

// ============================================================================
// DATA ACCESS FUNCTIONS
// ============================================================================

/**
 * Get unified files report with filtering
 */
export async function getUnifiedFilesReport(
  filters: UnifiedFilesFilters = {}
): Promise<UnifiedFilesReport> {
  const files: UnifiedFile[] = [];

  // Build date conditions for SQL
  const buildDateCondition = (
    dateField: typeof supplierFileUpload.periodStartDate | typeof uploadedFile.periodStartDate,
    startDate?: string,
    endDate?: string
  ) => {
    const conditions = [];
    if (startDate) {
      conditions.push(sql`${dateField} >= ${startDate}`);
    }
    if (endDate) {
      conditions.push(sql`${dateField} <= ${endDate}`);
    }
    return conditions;
  };

  // Query supplier files if not filtered to uploaded only
  if (!filters.source || filters.source === "supplier") {
    // Skip if entityType is franchisee (supplier files don't have franchisee entity type)
    if (!filters.entityType || filters.entityType === "supplier") {
      let supplierQuery = database
        .select({
          id: supplierFileUpload.id,
          originalFileName: supplierFileUpload.originalFileName,
          fileUrl: supplierFileUpload.fileUrl,
          fileSize: supplierFileUpload.fileSize,
          processingStatus: supplierFileUpload.processingStatus,
          createdAt: supplierFileUpload.createdAt,
          periodStartDate: supplierFileUpload.periodStartDate,
          periodEndDate: supplierFileUpload.periodEndDate,
          supplierId: supplierFileUpload.supplierId,
          supplierName: supplier.name,
          createdByName: user.name,
          createdByEmail: user.email,
        })
        .from(supplierFileUpload)
        .innerJoin(supplier, eq(supplierFileUpload.supplierId, supplier.id))
        .leftJoin(user, eq(supplierFileUpload.createdBy, user.id))
        .$dynamic();

      // Apply status filter
      if (filters.status) {
        supplierQuery = supplierQuery.where(
          eq(supplierFileUpload.processingStatus, filters.status as "pending" | "processing" | "auto_approved" | "needs_review" | "approved" | "rejected")
        );
      }

      // Apply date filters
      if (filters.startDate) {
        supplierQuery = supplierQuery.where(
          sql`${supplierFileUpload.periodStartDate} >= ${filters.startDate}`
        );
      }
      if (filters.endDate) {
        supplierQuery = supplierQuery.where(
          sql`${supplierFileUpload.periodEndDate} <= ${filters.endDate}`
        );
      }

      const supplierFiles = await supplierQuery.orderBy(desc(supplierFileUpload.createdAt));

      for (const file of supplierFiles) {
        files.push({
          id: file.id,
          source: "supplier",
          originalFileName: file.originalFileName,
          fileUrl: file.fileUrl,
          fileSize: file.fileSize,
          processingStatus: file.processingStatus,
          createdAt: file.createdAt,
          periodStartDate: file.periodStartDate,
          periodEndDate: file.periodEndDate,
          entityType: "supplier",
          entityId: file.supplierId,
          entityName: file.supplierName,
          uploadedByName: file.createdByName,
          uploadedByEmail: file.createdByEmail,
        });
      }
    }
  }

  // Query uploaded files if not filtered to supplier only
  if (!filters.source || filters.source === "uploaded") {
    let uploadedQuery = database
      .select({
        id: uploadedFile.id,
        originalFileName: uploadedFile.originalFileName,
        fileUrl: uploadedFile.fileUrl,
        fileSize: uploadedFile.fileSize,
        processingStatus: uploadedFile.processingStatus,
        createdAt: uploadedFile.createdAt,
        periodStartDate: uploadedFile.periodStartDate,
        periodEndDate: uploadedFile.periodEndDate,
        franchiseeId: uploadedFile.franchiseeId,
        uploadLinkId: uploadedFile.uploadLinkId,
        uploadedByEmail: uploadedFile.uploadedByEmail,
        franchiseeName: franchisee.name,
        uploadLinkEntityType: uploadLink.entityType,
        uploadLinkEntityId: uploadLink.entityId,
      })
      .from(uploadedFile)
      .leftJoin(franchisee, eq(uploadedFile.franchiseeId, franchisee.id))
      .leftJoin(uploadLink, eq(uploadedFile.uploadLinkId, uploadLink.id))
      .$dynamic();

    // Apply status filter
    if (filters.status) {
      uploadedQuery = uploadedQuery.where(
        eq(uploadedFile.processingStatus, filters.status as "pending" | "processing" | "auto_approved" | "needs_review" | "approved" | "rejected")
      );
    }

    // Apply entity type filter for uploaded files
    if (filters.entityType === "franchisee") {
      uploadedQuery = uploadedQuery.where(
        or(
          sql`${uploadedFile.franchiseeId} IS NOT NULL`,
          eq(uploadLink.entityType, "franchisee")
        )
      );
    } else if (filters.entityType === "supplier") {
      // Skip uploaded files when filtering by supplier entity type
      // (uploaded files are typically BKMVDATA from franchisees)
    }

    // Apply date filters
    if (filters.startDate) {
      uploadedQuery = uploadedQuery.where(
        sql`${uploadedFile.periodStartDate} >= ${filters.startDate}`
      );
    }
    if (filters.endDate) {
      uploadedQuery = uploadedQuery.where(
        sql`${uploadedFile.periodEndDate} <= ${filters.endDate}`
      );
    }

    // Only include if not filtered to supplier entity type
    if (!filters.entityType || filters.entityType !== "supplier") {
      const uploadedFiles = await uploadedQuery.orderBy(desc(uploadedFile.createdAt));

      for (const file of uploadedFiles) {
        // Determine entity info
        let entityType: "franchisee" | "upload_link" | null = null;
        let entityId: string | null = null;
        let entityName: string | null = null;

        if (file.franchiseeId) {
          entityType = "franchisee";
          entityId = file.franchiseeId;
          entityName = file.franchiseeName;
        } else if (file.uploadLinkId) {
          entityType = "upload_link";
          entityId = file.uploadLinkEntityId;
          // Would need additional query to get the actual entity name
          // For now, use the entity type from upload link
          entityName = file.uploadLinkEntityType ? `קישור העלאה (${file.uploadLinkEntityType})` : null;
        }

        files.push({
          id: file.id,
          source: "uploaded",
          originalFileName: file.originalFileName,
          fileUrl: file.fileUrl,
          fileSize: file.fileSize,
          processingStatus: file.processingStatus || "pending",
          createdAt: file.createdAt,
          periodStartDate: file.periodStartDate,
          periodEndDate: file.periodEndDate,
          entityType,
          entityId,
          entityName,
          uploadedByName: null,
          uploadedByEmail: file.uploadedByEmail,
        });
      }
    }
  }

  // Sort all files by creation date
  files.sort((a, b) => b.createdAt.getTime() - a.createdAt.getTime());

  // Calculate summary by source
  const supplierFilesCount = files.filter((f) => f.source === "supplier").length;
  const uploadedFilesCount = files.filter((f) => f.source === "uploaded").length;
  const supplierFilesSize = files
    .filter((f) => f.source === "supplier")
    .reduce((sum, f) => sum + (f.fileSize || 0), 0);
  const uploadedFilesSize = files
    .filter((f) => f.source === "uploaded")
    .reduce((sum, f) => sum + (f.fileSize || 0), 0);
  const pendingReview = files.filter(
    (f) => f.processingStatus === "needs_review" || f.processingStatus === "pending"
  ).length;

  const bySource: UnifiedFileSummary[] = [
    {
      source: "supplier",
      label: "קבצי ספקים",
      count: supplierFilesCount,
      totalSize: supplierFilesSize,
    },
    {
      source: "uploaded",
      label: "קבצים אחידים",
      count: uploadedFilesCount,
      totalSize: uploadedFilesSize,
    },
  ];

  // Get period range
  const validDates = files
    .filter((f) => f.periodStartDate && f.periodEndDate)
    .flatMap((f) => [f.periodStartDate!, f.periodEndDate!])
    .sort();

  return {
    summary: {
      totalFiles: files.length,
      totalSize: supplierFilesSize + uploadedFilesSize,
      supplierFiles: supplierFilesCount,
      uploadedFiles: uploadedFilesCount,
      pendingReview,
      periodRange: {
        startDate: validDates[0] || null,
        endDate: validDates[validDates.length - 1] || null,
      },
      generatedAt: new Date().toISOString(),
    },
    bySource,
    files,
  };
}

/**
 * Get filter options for unified files report
 */
export const getUnifiedFilesFilterOptions = unstable_cache(
  async (): Promise<UnifiedFilesFilterOptions> => {
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

    // Get all franchisees that have uploaded files
    const franchisees = await database
      .selectDistinct({
        id: franchisee.id,
        name: franchisee.name,
        code: franchisee.code,
      })
      .from(franchisee)
      .innerJoin(uploadedFile, eq(franchisee.id, uploadedFile.franchiseeId))
      .where(eq(franchisee.isActive, true))
      .orderBy(franchisee.name);

    // Get all brands
    const brands = await database
      .select({
        id: brand.id,
        nameHe: brand.nameHe,
        nameEn: brand.nameEn,
      })
      .from(brand)
      .orderBy(brand.nameHe);

    // Static options
    const sources: UnifiedFilesFilterOptions["sources"] = [
      { value: "all", label: "כל המקורות" },
      { value: "supplier", label: "קבצי ספקים" },
      { value: "uploaded", label: "קבצים אחידים" },
    ];

    const entityTypes = [
      { value: "all", label: "כל הסוגים" },
      { value: "supplier", label: "ספק" },
      { value: "franchisee", label: "זכיין" },
    ];

    const statuses = [
      { value: "all", label: "כל הסטטוסים" },
      { value: "pending", label: "ממתין" },
      { value: "processing", label: "בעיבוד" },
      { value: "auto_approved", label: "אושר אוטומטית" },
      { value: "needs_review", label: "דורש בדיקה" },
      { value: "approved", label: "מאושר" },
      { value: "rejected", label: "נדחה" },
    ];

    return {
      sources,
      entityTypes,
      statuses,
      suppliers: suppliers.map((s) => ({
        id: s.id,
        name: s.name,
        code: s.code,
      })),
      franchisees: franchisees.map((f) => ({
        id: f.id,
        name: f.name,
        code: f.code,
      })),
      brands: brands.map((b) => ({
        id: b.id,
        name: b.nameEn || undefined,
        nameHe: b.nameHe,
      })),
    };
  },
  ["unified-files-filter-options"],
  { revalidate: 300 } // Cache for 5 minutes
);

/**
 * Get uploaded file by ID (for download validation)
 * This is for files in the uploaded_file table (not supplier_file_upload)
 */
export async function getUploadedFileByIdForDownload(fileId: string): Promise<{
  id: string;
  fileUrl: string | null;
  fileName: string;
} | null> {
  const result = await database
    .select({
      id: uploadedFile.id,
      fileUrl: uploadedFile.fileUrl,
      fileName: uploadedFile.originalFileName,
    })
    .from(uploadedFile)
    .where(eq(uploadedFile.id, fileId))
    .limit(1);

  return result[0] || null;
}

/**
 * Get a unified file by ID and source (for download validation)
 */
export async function getUnifiedFileByIdForDownload(
  fileId: string,
  source: UnifiedFileSource
): Promise<{
  id: string;
  fileUrl: string | null;
  fileName: string;
} | null> {
  if (source === "supplier") {
    const result = await database
      .select({
        id: supplierFileUpload.id,
        fileUrl: supplierFileUpload.fileUrl,
        fileName: supplierFileUpload.originalFileName,
      })
      .from(supplierFileUpload)
      .where(eq(supplierFileUpload.id, fileId))
      .limit(1);
    return result[0] || null;
  } else {
    return getUploadedFileByIdForDownload(fileId);
  }
}
