import { database } from "@/db";
import {
  supplierFileUpload,
  supplier,
  user,
  franchisee,
  type SupplierFileUpload,
  type CreateSupplierFileUploadData,
  type UpdateSupplierFileUploadData,
  type SupplierFileProcessingResult,
} from "@/db/schema";
import { eq, and, desc, sql, count, gte, lte, ne, or, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";

// Extended type with supplier info
export type SupplierFileUploadWithSupplier = SupplierFileUpload & {
  supplierName: string | null;
  supplierCode: string | null;
};

// Extended type with full details including reviewer
export type SupplierFileUploadWithDetails = SupplierFileUploadWithSupplier & {
  reviewedByName: string | null;
  reviewedByEmail: string | null;
  createdByName: string | null;
  createdByEmail: string | null;
};

/**
 * Get all supplier files needing review (status = needs_review)
 */
export async function getSupplierFilesNeedingReview(): Promise<SupplierFileUploadWithSupplier[]> {
  const results = await database
    .select({
      id: supplierFileUpload.id,
      supplierId: supplierFileUpload.supplierId,
      originalFileName: supplierFileUpload.originalFileName,
      fileUrl: supplierFileUpload.fileUrl,
      fileSize: supplierFileUpload.fileSize,
      filePath: supplierFileUpload.filePath,
      processingStatus: supplierFileUpload.processingStatus,
      processingResult: supplierFileUpload.processingResult,
      reviewedBy: supplierFileUpload.reviewedBy,
      reviewedAt: supplierFileUpload.reviewedAt,
      reviewNotes: supplierFileUpload.reviewNotes,
      periodStartDate: supplierFileUpload.periodStartDate,
      periodEndDate: supplierFileUpload.periodEndDate,
      createdAt: supplierFileUpload.createdAt,
      updatedAt: supplierFileUpload.updatedAt,
      createdBy: supplierFileUpload.createdBy,
      supplierName: supplier.name,
      supplierCode: supplier.code,
    })
    .from(supplierFileUpload)
    .leftJoin(supplier, eq(supplierFileUpload.supplierId, supplier.id))
    .where(eq(supplierFileUpload.processingStatus, "needs_review"))
    .orderBy(desc(supplierFileUpload.createdAt));

  return results;
}

/**
 * Get supplier file by ID with supplier info
 */
export async function getSupplierFileById(
  fileId: string
): Promise<SupplierFileUploadWithDetails | null> {
  const results = await database
    .select({
      id: supplierFileUpload.id,
      supplierId: supplierFileUpload.supplierId,
      originalFileName: supplierFileUpload.originalFileName,
      fileUrl: supplierFileUpload.fileUrl,
      fileSize: supplierFileUpload.fileSize,
      filePath: supplierFileUpload.filePath,
      processingStatus: supplierFileUpload.processingStatus,
      processingResult: supplierFileUpload.processingResult,
      reviewedBy: supplierFileUpload.reviewedBy,
      reviewedAt: supplierFileUpload.reviewedAt,
      reviewNotes: supplierFileUpload.reviewNotes,
      periodStartDate: supplierFileUpload.periodStartDate,
      periodEndDate: supplierFileUpload.periodEndDate,
      createdAt: supplierFileUpload.createdAt,
      updatedAt: supplierFileUpload.updatedAt,
      createdBy: supplierFileUpload.createdBy,
      supplierName: supplier.name,
      supplierCode: supplier.code,
    })
    .from(supplierFileUpload)
    .leftJoin(supplier, eq(supplierFileUpload.supplierId, supplier.id))
    .where(eq(supplierFileUpload.id, fileId))
    .limit(1);

  if (results.length === 0) return null;

  const file = results[0];

  // Get reviewer info if exists
  let reviewedByName: string | null = null;
  let reviewedByEmail: string | null = null;

  if (file.reviewedBy) {
    const reviewerResult = await database
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, file.reviewedBy))
      .limit(1);

    if (reviewerResult.length > 0) {
      reviewedByName = reviewerResult[0].name;
      reviewedByEmail = reviewerResult[0].email;
    }
  }

  // Get creator info if exists
  let createdByName: string | null = null;
  let createdByEmail: string | null = null;

  if (file.createdBy) {
    const creatorResult = await database
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, file.createdBy))
      .limit(1);

    if (creatorResult.length > 0) {
      createdByName = creatorResult[0].name;
      createdByEmail = creatorResult[0].email;
    }
  }

  return {
    ...file,
    reviewedByName,
    reviewedByEmail,
    createdByName,
    createdByEmail,
  };
}

/**
 * Create a new supplier file upload record
 */
export async function createSupplierFileUpload(
  data: Omit<CreateSupplierFileUploadData, "id"> & { id?: string }
): Promise<SupplierFileUpload> {
  const id = data.id || randomUUID();

  const [newRecord] = await database
    .insert(supplierFileUpload)
    .values({
      ...data,
      id,
    })
    .returning();

  return newRecord;
}

/**
 * Update supplier file processing result and status
 */
export async function updateSupplierFileProcessing(
  fileId: string,
  result: SupplierFileProcessingResult,
  status: "auto_approved" | "needs_review"
): Promise<SupplierFileUpload | null> {
  const [updated] = await database
    .update(supplierFileUpload)
    .set({
      processingResult: result,
      processingStatus: status,
      updatedAt: new Date(),
    })
    .where(eq(supplierFileUpload.id, fileId))
    .returning();

  return updated || null;
}

/**
 * Review (approve/reject) a supplier file
 */
export async function reviewSupplierFile(
  fileId: string,
  action: "approve" | "reject",
  reviewedBy: string,
  notes?: string
): Promise<SupplierFileUpload | null> {
  const status = action === "approve" ? "approved" : "rejected";

  const [updated] = await database
    .update(supplierFileUpload)
    .set({
      processingStatus: status,
      reviewedBy,
      reviewedAt: new Date(),
      reviewNotes: notes || null,
      updatedAt: new Date(),
    })
    .where(eq(supplierFileUpload.id, fileId))
    .returning();

  return updated || null;
}

/**
 * Update a single match in the processing result (for manual matching)
 */
export async function updateSupplierFileMatch(
  fileId: string,
  originalName: string,
  franchiseeId: string,
  franchiseeName: string
): Promise<SupplierFileUpload | null> {
  // Get current file
  const file = await getSupplierFileById(fileId);
  if (!file || !file.processingResult) return null;

  const processingResult = { ...file.processingResult };

  // Find and update the matching franchisee match
  const matchIndex = processingResult.franchiseeMatches.findIndex(
    (m) => m.originalName === originalName
  );

  if (matchIndex === -1) return null;

  // Update the match
  processingResult.franchiseeMatches[matchIndex] = {
    ...processingResult.franchiseeMatches[matchIndex],
    matchedFranchiseeId: franchiseeId,
    matchedFranchiseeName: franchiseeName,
    matchType: "manual",
    confidence: 100,
    requiresReview: false,
  };

  // Recalculate match stats
  const stats = {
    total: processingResult.franchiseeMatches.length,
    exactMatches: 0,
    fuzzyMatches: 0,
    unmatched: 0,
  };

  for (const match of processingResult.franchiseeMatches) {
    if (match.matchType === "exact" || match.matchType === "manual") {
      stats.exactMatches++;
    } else if (match.matchType === "fuzzy") {
      stats.fuzzyMatches++;
    } else if (match.matchType === "none" || !match.matchedFranchiseeId) {
      stats.unmatched++;
    }
    // blacklisted doesn't count toward any category
  }

  processingResult.matchStats = stats;

  // Update the record
  const [updated] = await database
    .update(supplierFileUpload)
    .set({
      processingResult,
      updatedAt: new Date(),
    })
    .where(eq(supplierFileUpload.id, fileId))
    .returning();

  return updated || null;
}

/**
 * Mark a match as blacklisted in the processing result
 */
export async function markSupplierFileMatchAsBlacklisted(
  fileId: string,
  originalName: string
): Promise<SupplierFileUpload | null> {
  // Get current file
  const file = await getSupplierFileById(fileId);
  if (!file || !file.processingResult) return null;

  const processingResult = { ...file.processingResult };

  // Find and update the matching franchisee match
  const matchIndex = processingResult.franchiseeMatches.findIndex(
    (m) => m.originalName === originalName
  );

  if (matchIndex === -1) return null;

  // Update the match to blacklisted
  processingResult.franchiseeMatches[matchIndex] = {
    ...processingResult.franchiseeMatches[matchIndex],
    matchType: "blacklisted",
    requiresReview: false,
  };

  // Recalculate match stats (blacklisted items don't count toward unmatched)
  const stats = {
    total: processingResult.franchiseeMatches.length,
    exactMatches: 0,
    fuzzyMatches: 0,
    unmatched: 0,
  };

  for (const match of processingResult.franchiseeMatches) {
    if (match.matchType === "exact" || match.matchType === "manual") {
      stats.exactMatches++;
    } else if (match.matchType === "fuzzy") {
      stats.fuzzyMatches++;
    } else if (match.matchType === "none" || (!match.matchedFranchiseeId && match.matchType !== "blacklisted")) {
      stats.unmatched++;
    }
  }

  processingResult.matchStats = stats;

  // Update the record
  const [updated] = await database
    .update(supplierFileUpload)
    .set({
      processingResult,
      updatedAt: new Date(),
    })
    .where(eq(supplierFileUpload.id, fileId))
    .returning();

  return updated || null;
}

/**
 * Get count of supplier files needing review (for sidebar badge)
 */
export async function getSupplierFileReviewCount(): Promise<number> {
  const result = await database
    .select({ count: count() })
    .from(supplierFileUpload)
    .where(eq(supplierFileUpload.processingStatus, "needs_review"));

  return result[0]?.count || 0;
}

/**
 * Get all supplier file uploads with optional filters
 */
export async function getSupplierFileUploads(options?: {
  supplierId?: string;
  status?: string[];
  periodStartDate?: string;
  periodEndDate?: string;
  limit?: number;
  offset?: number;
}): Promise<{
  files: SupplierFileUploadWithSupplier[];
  total: number;
}> {
  const conditions = [];

  if (options?.supplierId) {
    conditions.push(eq(supplierFileUpload.supplierId, options.supplierId));
  }

  if (options?.status && options.status.length > 0) {
    conditions.push(
      sql`${supplierFileUpload.processingStatus} = ANY(${options.status})`
    );
  }

  if (options?.periodStartDate) {
    conditions.push(
      sql`${supplierFileUpload.periodStartDate} >= ${options.periodStartDate}`
    );
  }

  if (options?.periodEndDate) {
    conditions.push(
      sql`${supplierFileUpload.periodEndDate} <= ${options.periodEndDate}`
    );
  }

  // Get total count
  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  const countResult = await database
    .select({ count: count() })
    .from(supplierFileUpload)
    .where(whereClause);

  const total = countResult[0]?.count || 0;

  // Build main query
  let query = database
    .select({
      id: supplierFileUpload.id,
      supplierId: supplierFileUpload.supplierId,
      originalFileName: supplierFileUpload.originalFileName,
      fileUrl: supplierFileUpload.fileUrl,
      fileSize: supplierFileUpload.fileSize,
      filePath: supplierFileUpload.filePath,
      processingStatus: supplierFileUpload.processingStatus,
      processingResult: supplierFileUpload.processingResult,
      reviewedBy: supplierFileUpload.reviewedBy,
      reviewedAt: supplierFileUpload.reviewedAt,
      reviewNotes: supplierFileUpload.reviewNotes,
      periodStartDate: supplierFileUpload.periodStartDate,
      periodEndDate: supplierFileUpload.periodEndDate,
      createdAt: supplierFileUpload.createdAt,
      updatedAt: supplierFileUpload.updatedAt,
      createdBy: supplierFileUpload.createdBy,
      supplierName: supplier.name,
      supplierCode: supplier.code,
    })
    .from(supplierFileUpload)
    .leftJoin(supplier, eq(supplierFileUpload.supplierId, supplier.id))
    .where(whereClause)
    .orderBy(desc(supplierFileUpload.createdAt))
    .$dynamic();

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  if (options?.offset) {
    query = query.offset(options.offset);
  }

  const files = await query;

  return { files, total };
}

/**
 * Delete a supplier file upload by ID
 */
export async function deleteSupplierFileUpload(fileId: string): Promise<boolean> {
  const result = await database
    .delete(supplierFileUpload)
    .where(eq(supplierFileUpload.id, fileId));

  return (result.rowCount ?? 0) > 0;
}

/**
 * Get review statistics for dashboard
 */
export async function getSupplierFileReviewStats(): Promise<{
  pending: number;
  approvedToday: number;
  rejectedToday: number;
}> {
  const today = new Date();
  today.setHours(0, 0, 0, 0);

  // Get pending count
  const pendingResult = await database
    .select({ count: count() })
    .from(supplierFileUpload)
    .where(eq(supplierFileUpload.processingStatus, "needs_review"));

  // Get approved today count
  const approvedResult = await database
    .select({ count: count() })
    .from(supplierFileUpload)
    .where(
      and(
        eq(supplierFileUpload.processingStatus, "approved"),
        sql`${supplierFileUpload.reviewedAt} >= ${today}`
      )
    );

  // Get rejected today count
  const rejectedResult = await database
    .select({ count: count() })
    .from(supplierFileUpload)
    .where(
      and(
        eq(supplierFileUpload.processingStatus, "rejected"),
        sql`${supplierFileUpload.reviewedAt} >= ${today}`
      )
    );

  return {
    pending: pendingResult[0]?.count || 0,
    approvedToday: approvedResult[0]?.count || 0,
    rejectedToday: rejectedResult[0]?.count || 0,
  };
}

/**
 * Update supplier file upload metadata
 */
export async function updateSupplierFileUpload(
  fileId: string,
  data: UpdateSupplierFileUploadData
): Promise<SupplierFileUpload | null> {
  const [updated] = await database
    .update(supplierFileUpload)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(supplierFileUpload.id, fileId))
    .returning();

  return updated || null;
}

/**
 * Add an alias to a franchisee when manually matching
 * This is a helper that updates the franchisee's aliases array
 */
export async function addFranchiseeAlias(
  franchiseeId: string,
  alias: string
): Promise<boolean> {
  // Get current franchisee
  const [current] = await database
    .select({ aliases: franchisee.aliases })
    .from(franchisee)
    .where(eq(franchisee.id, franchiseeId))
    .limit(1);

  if (!current) return false;

  // Add alias if not already present
  const normalizedAlias = alias.trim();
  const currentAliases = (current.aliases as string[] | null) || [];

  if (currentAliases.includes(normalizedAlias)) {
    // Already exists
    return true;
  }

  const updatedAliases = [...currentAliases, normalizedAlias];

  await database
    .update(franchisee)
    .set({
      aliases: updatedAliases,
      updatedAt: new Date(),
    })
    .where(eq(franchisee.id, franchiseeId));

  return true;
}

/**
 * Check if a supplier file already exists for a given period.
 * Returns the existing file if found (excluding rejected files).
 */
export async function getSupplierFileByPeriod(
  supplierId: string,
  periodStartDate: Date,
  periodEndDate: Date
): Promise<SupplierFileUploadWithSupplier | null> {
  const results = await database
    .select({
      id: supplierFileUpload.id,
      supplierId: supplierFileUpload.supplierId,
      originalFileName: supplierFileUpload.originalFileName,
      fileUrl: supplierFileUpload.fileUrl,
      fileSize: supplierFileUpload.fileSize,
      filePath: supplierFileUpload.filePath,
      processingStatus: supplierFileUpload.processingStatus,
      processingResult: supplierFileUpload.processingResult,
      reviewedBy: supplierFileUpload.reviewedBy,
      reviewedAt: supplierFileUpload.reviewedAt,
      reviewNotes: supplierFileUpload.reviewNotes,
      periodStartDate: supplierFileUpload.periodStartDate,
      periodEndDate: supplierFileUpload.periodEndDate,
      createdAt: supplierFileUpload.createdAt,
      updatedAt: supplierFileUpload.updatedAt,
      createdBy: supplierFileUpload.createdBy,
      supplierName: supplier.name,
      supplierCode: supplier.code,
    })
    .from(supplierFileUpload)
    .leftJoin(supplier, eq(supplierFileUpload.supplierId, supplier.id))
    .where(
      and(
        eq(supplierFileUpload.supplierId, supplierId),
        eq(supplierFileUpload.periodStartDate, periodStartDate.toISOString().split('T')[0]),
        eq(supplierFileUpload.periodEndDate, periodEndDate.toISOString().split('T')[0]),
        // Exclude rejected files - they shouldn't block new uploads
        ne(supplierFileUpload.processingStatus, "rejected")
      )
    )
    .orderBy(desc(supplierFileUpload.createdAt))
    .limit(1);

  return results.length > 0 ? results[0] : null;
}

/**
 * Get all supplier file uploads for a specific supplier within a year.
 * Returns files with their periods for completeness tracking.
 */
export async function getSupplierFileUploadsBySupplierAndYear(
  supplierId: string,
  year: number
): Promise<SupplierFileUploadWithSupplier[]> {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const results = await database
    .select({
      id: supplierFileUpload.id,
      supplierId: supplierFileUpload.supplierId,
      originalFileName: supplierFileUpload.originalFileName,
      fileUrl: supplierFileUpload.fileUrl,
      fileSize: supplierFileUpload.fileSize,
      filePath: supplierFileUpload.filePath,
      processingStatus: supplierFileUpload.processingStatus,
      processingResult: supplierFileUpload.processingResult,
      reviewedBy: supplierFileUpload.reviewedBy,
      reviewedAt: supplierFileUpload.reviewedAt,
      reviewNotes: supplierFileUpload.reviewNotes,
      periodStartDate: supplierFileUpload.periodStartDate,
      periodEndDate: supplierFileUpload.periodEndDate,
      createdAt: supplierFileUpload.createdAt,
      updatedAt: supplierFileUpload.updatedAt,
      createdBy: supplierFileUpload.createdBy,
      supplierName: supplier.name,
      supplierCode: supplier.code,
    })
    .from(supplierFileUpload)
    .leftJoin(supplier, eq(supplierFileUpload.supplierId, supplier.id))
    .where(
      and(
        eq(supplierFileUpload.supplierId, supplierId),
        gte(supplierFileUpload.periodStartDate, yearStart),
        lte(supplierFileUpload.periodEndDate, yearEnd)
      )
    )
    .orderBy(desc(supplierFileUpload.periodStartDate));

  return results;
}

/**
 * Get all supplier files for a specific year (all suppliers).
 * Used for the completeness dashboard.
 */
export async function getAllSupplierFileUploadsForYear(
  year: number
): Promise<SupplierFileUploadWithSupplier[]> {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  const results = await database
    .select({
      id: supplierFileUpload.id,
      supplierId: supplierFileUpload.supplierId,
      originalFileName: supplierFileUpload.originalFileName,
      fileUrl: supplierFileUpload.fileUrl,
      fileSize: supplierFileUpload.fileSize,
      filePath: supplierFileUpload.filePath,
      processingStatus: supplierFileUpload.processingStatus,
      processingResult: supplierFileUpload.processingResult,
      reviewedBy: supplierFileUpload.reviewedBy,
      reviewedAt: supplierFileUpload.reviewedAt,
      reviewNotes: supplierFileUpload.reviewNotes,
      periodStartDate: supplierFileUpload.periodStartDate,
      periodEndDate: supplierFileUpload.periodEndDate,
      createdAt: supplierFileUpload.createdAt,
      updatedAt: supplierFileUpload.updatedAt,
      createdBy: supplierFileUpload.createdBy,
      supplierName: supplier.name,
      supplierCode: supplier.code,
    })
    .from(supplierFileUpload)
    .leftJoin(supplier, eq(supplierFileUpload.supplierId, supplier.id))
    .where(
      and(
        gte(supplierFileUpload.periodStartDate, yearStart),
        lte(supplierFileUpload.periodEndDate, yearEnd)
      )
    )
    .orderBy(desc(supplierFileUpload.periodStartDate));

  return results;
}
