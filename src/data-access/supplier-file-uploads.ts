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
  type Franchisee,
} from "@/db/schema";
import { eq, and, desc, sql, count, gte, lte, ne, or, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";
import { formatDateAsLocal } from "@/lib/date-utils";
import { calculateBatchCommissions } from "./commissions";
import { getOrCreateSettlementPeriodByPeriodKey } from "./settlements";
import { derivePeriodKey } from "@/lib/settlement-periods";
import type { SettlementPeriodType } from "@/db/schema";

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
 * Recompute match stats from a franchiseeMatches array.
 * Shared by updateSupplierFileMatch, markSupplierFileMatchAsBlacklisted,
 * and sweepRematchUnmatchedRows so they stay consistent.
 */
function recomputeMatchStats(
  matches: SupplierFileProcessingResult["franchiseeMatches"]
) {
  const stats = {
    total: matches.length,
    exactMatches: 0,
    fuzzyMatches: 0,
    unmatched: 0,
  };

  for (const match of matches) {
    if (match.matchType === "exact" || match.matchType === "exact_code" || match.matchType === "manual") {
      stats.exactMatches++;
    } else if (match.matchType === "fuzzy") {
      stats.fuzzyMatches++;
    } else if (
      match.matchType === "none" ||
      (!match.matchedFranchiseeId && match.matchType !== "blacklisted")
    ) {
      stats.unmatched++;
    }
    // blacklisted doesn't count toward any category
  }

  return stats;
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

  processingResult.matchStats = recomputeMatchStats(processingResult.franchiseeMatches);

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

  processingResult.matchStats = recomputeMatchStats(processingResult.franchiseeMatches);

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
 * Add an alias to a franchisee when manually matching.
 * Returns `"added"` if newly inserted, `"existed"` if already present
 * (case-insensitive dedup), `"missing"` if the franchisee was not found.
 */
export async function addFranchiseeAlias(
  franchiseeId: string,
  alias: string
): Promise<"added" | "existed" | "missing"> {
  // Get current franchisee
  const [current] = await database
    .select({ aliases: franchisee.aliases })
    .from(franchisee)
    .where(eq(franchisee.id, franchiseeId))
    .limit(1);

  if (!current) return "missing";

  const normalizedAlias = alias.trim();
  if (!normalizedAlias) return "existed";

  const currentAliases = (current.aliases as string[] | null) || [];
  const aliasLower = normalizedAlias.toLowerCase();

  if (currentAliases.some((a) => a.trim().toLowerCase() === aliasLower)) {
    return "existed";
  }

  const updatedAliases = [...currentAliases, normalizedAlias];

  await database
    .update(franchisee)
    .set({
      aliases: updatedAliases,
      updatedAt: new Date(),
    })
    .where(eq(franchisee.id, franchiseeId));

  return "added";
}

/**
 * Re-run franchisee name matching across rows in a supplier file that are still
 * unmatched, using fresh franchisee/alias state from the DB. Used after the admin
 * adds a new alias via the review modal so other rows that should match via the
 * new alias get picked up automatically — eliminating the "re-upload to see full
 * match" workaround.
 *
 * Only touches rows where:
 *   - matchType is "none", AND
 *   - no matchedFranchiseeId is set, AND
 *   - row was not manually matched, blacklisted, or matched by exact_code
 *
 * Manual fixes the admin already made are preserved.
 *
 * @returns Updated supplier file row with new matchStats, or null if file missing.
 */
export async function sweepRematchUnmatchedRows(
  fileId: string
): Promise<{
  file: SupplierFileUpload;
  newlyMatchedCount: number;
} | null> {
  const file = await getSupplierFileById(fileId);
  if (!file || !file.processingResult) return null;

  const processingResult = { ...file.processingResult };
  const matches = [...processingResult.franchiseeMatches];

  const targetIndices: number[] = [];
  for (let i = 0; i < matches.length; i++) {
    const m = matches[i];
    const isUnmatched =
      m.matchType === "none" && !m.matchedFranchiseeId;
    if (isUnmatched) {
      targetIndices.push(i);
    }
  }

  if (targetIndices.length === 0) {
    return { file, newlyMatchedCount: 0 };
  }

  // Fresh franchisees snapshot — picks up aliases written since first processing
  const allFranchisees = (await database
    .select()
    .from(franchisee)
    .orderBy(desc(franchisee.createdAt))) as Franchisee[];

  const { matchFranchiseeName } = await import("@/lib/franchisee-matcher");

  let newlyMatchedCount = 0;

  for (const i of targetIndices) {
    const original = matches[i];
    const result = matchFranchiseeName(original.originalName, allFranchisees);

    if (!result.matchedFranchisee) continue;

    // Translate matcher MatchType -> persisted shape (parity with upload route's getMatchType)
    let persistedType: typeof original.matchType = "none";
    if (result.matchType === "exact_code") persistedType = "exact_code";
    else if (result.confidence === 1) persistedType = "exact";
    else persistedType = "fuzzy";

    matches[i] = {
      ...original,
      matchedFranchiseeId: result.matchedFranchisee.id,
      matchedFranchiseeName: result.matchedFranchisee.name,
      confidence: result.confidence,
      matchType: persistedType,
      requiresReview: result.requiresReview,
    };

    newlyMatchedCount++;
  }

  processingResult.franchiseeMatches = matches;
  processingResult.matchStats = recomputeMatchStats(matches);

  const [updated] = await database
    .update(supplierFileUpload)
    .set({
      processingResult,
      updatedAt: new Date(),
    })
    .where(eq(supplierFileUpload.id, fileId))
    .returning();

  return updated
    ? { file: updated, newlyMatchedCount }
    : null;
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
        eq(supplierFileUpload.periodStartDate, formatDateAsLocal(periodStartDate)),
        eq(supplierFileUpload.periodEndDate, formatDateAsLocal(periodEndDate)),
        // Exclude rejected files - they shouldn't block new uploads
        ne(supplierFileUpload.processingStatus, "rejected")
      )
    )
    .orderBy(desc(supplierFileUpload.createdAt))
    .limit(1);

  return results.length > 0 ? results[0] : null;
}

/**
 * Find existing supplier files that overlap with the given period and contain
 * any of the specified matched franchisee IDs.
 * Used for duplicate detection when uploading per-franchisee files.
 *
 * @returns Array of existing files with the overlapping franchisee IDs
 */
export async function findDuplicateSupplierFiles(
  supplierId: string,
  periodStartDate: string,
  periodEndDate: string,
  matchedFranchiseeIds: string[]
): Promise<Array<{ fileId: string; originalFileName: string; overlappingFranchiseeIds: string[]; createdAt: Date }>> {
  if (matchedFranchiseeIds.length === 0) return [];

  console.log("[findDuplicateSupplierFiles] Checking for duplicates:", {
    supplierId,
    periodStartDate,
    periodEndDate,
    matchedFranchiseeIds,
  });

  // Get all non-rejected files for this supplier that overlap with the period
  const results = await database
    .select({
      id: supplierFileUpload.id,
      originalFileName: supplierFileUpload.originalFileName,
      processingResult: supplierFileUpload.processingResult,
      periodStartDate: supplierFileUpload.periodStartDate,
      periodEndDate: supplierFileUpload.periodEndDate,
      createdAt: supplierFileUpload.createdAt,
    })
    .from(supplierFileUpload)
    .where(
      and(
        eq(supplierFileUpload.supplierId, supplierId),
        ne(supplierFileUpload.processingStatus, "rejected"),
        // Check for period overlap: existing.start <= new.end AND existing.end >= new.start
        lte(supplierFileUpload.periodStartDate, periodEndDate),
        gte(supplierFileUpload.periodEndDate, periodStartDate)
      )
    )
    .orderBy(desc(supplierFileUpload.createdAt));

  console.log(`[findDuplicateSupplierFiles] Found ${results.length} existing files with overlapping periods`);

  const duplicates: Array<{
    fileId: string;
    originalFileName: string;
    overlappingFranchiseeIds: string[];
    createdAt: Date;
  }> = [];

  const matchedSet = new Set(matchedFranchiseeIds);

  for (const file of results) {
    if (!file.processingResult) {
      console.log(`[findDuplicateSupplierFiles] File ${file.id} has no processingResult, skipping`);
      continue;
    }

    const result = file.processingResult as SupplierFileProcessingResult;
    const existingFranchiseeIds = result.franchiseeMatches
      ?.map((m) => m.matchedFranchiseeId)
      .filter((id): id is string => {
        if (id == null) return false;
        if (typeof id === 'string' && id.trim() === '') {
          console.warn(`[findDuplicateSupplierFiles] File ${file.id} has empty string matchedFranchiseeId`);
          return false;
        }
        return true;
      }) ?? [];

    console.log(`[findDuplicateSupplierFiles] File ${file.originalFileName} (${file.id}):`, {
      existingFranchiseeIds,
      newFranchiseeIds: matchedFranchiseeIds,
    });

    const overlapping = result.franchiseeMatches
      ?.filter((m) => m.matchedFranchiseeId && matchedSet.has(m.matchedFranchiseeId))
      .map((m) => m.matchedFranchiseeId!)
      ?? [];

    if (overlapping.length > 0) {
      console.log(`[findDuplicateSupplierFiles] DUPLICATE FOUND: ${file.originalFileName} overlaps on franchisee IDs:`, overlapping);
      duplicates.push({
        fileId: file.id,
        originalFileName: file.originalFileName,
        overlappingFranchiseeIds: overlapping,
        createdAt: file.createdAt,
      });
    }
  }

  console.log(`[findDuplicateSupplierFiles] Total duplicates found: ${duplicates.length}`);

  return duplicates;
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
 * Lightweight version for dashboard supplier-completeness.
 * Omits heavy processingResult JSONB and other unused columns.
 */
export async function getSupplierFileUploadSummariesForYear(
  year: number
) {
  const yearStart = `${year}-01-01`;
  const yearEnd = `${year}-12-31`;

  return database
    .select({
      id: supplierFileUpload.id,
      supplierId: supplierFileUpload.supplierId,
      originalFileName: supplierFileUpload.originalFileName,
      processingStatus: supplierFileUpload.processingStatus,
      periodStartDate: supplierFileUpload.periodStartDate,
      periodEndDate: supplierFileUpload.periodEndDate,
    })
    .from(supplierFileUpload)
    .where(
      and(
        gte(supplierFileUpload.periodStartDate, yearStart),
        lte(supplierFileUpload.periodEndDate, yearEnd)
      )
    )
    .orderBy(desc(supplierFileUpload.periodStartDate));
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

// ============================================================================
// COMMISSION SYNC FROM UPLOAD
// ============================================================================

export type SyncCommissionsResult = {
  created: number;
  failed: number;
  skipped: boolean;
  reason?: string;
};

/**
 * Recreate commissions for a supplier_file_upload from its current
 * processing_result.franchiseeMatches.
 *
 * Why this exists: the upload lifecycle has several touch points (initial save,
 * manual review match, approve via review queue) that all need to reflect the
 * latest matches in the commission table. calculateBatchCommissions handles the
 * delete-and-replace of existing calculated/pending commissions for the same
 * (supplier, period), so calling this is idempotent.
 *
 * Includes every match with a non-null matchedFranchiseeId and a non-terminal
 * matchType — by the time the file is saved or approved the admin has decided
 * what to do with each row, so blacklisted/none are the only exclusions.
 * Multiple file rows mapping to the same franchisee (e.g. עפולה under two
 * supplier-side names) get aggregated into one commission row.
 *
 * Returns skipped=true when there's nothing to do (rejected file, no matches,
 * missing processing_result) so callers can decide whether to surface anything.
 */
export async function syncCommissionsFromUpload(
  fileId: string,
  userId: string
): Promise<SyncCommissionsResult> {
  const file = await getSupplierFileById(fileId);
  if (!file) {
    return { created: 0, failed: 0, skipped: true, reason: "file_not_found" };
  }
  if (file.processingStatus === "rejected") {
    return { created: 0, failed: 0, skipped: true, reason: "file_rejected" };
  }
  if (!file.processingResult || !file.processingResult.franchiseeMatches) {
    return { created: 0, failed: 0, skipped: true, reason: "no_processing_result" };
  }
  if (!file.periodStartDate || !file.periodEndDate) {
    return { created: 0, failed: 0, skipped: true, reason: "no_period" };
  }

  // Load supplier settings needed for commission rate fallback + period derivation
  const [supplierRow] = await database
    .select({
      vatIncluded: supplier.vatIncluded,
      settlementFrequency: supplier.settlementFrequency,
      fiscalYearStartMonth: supplier.fiscalYearStartMonth,
    })
    .from(supplier)
    .where(eq(supplier.id, file.supplierId))
    .limit(1);

  if (!supplierRow) {
    return { created: 0, failed: 0, skipped: true, reason: "supplier_not_found" };
  }

  const matches = file.processingResult.franchiseeMatches.filter(
    (m) =>
      m.matchedFranchiseeId !== null &&
      m.matchType !== "blacklisted" &&
      m.matchType !== "none"
  );

  if (matches.length === 0) {
    return { created: 0, failed: 0, skipped: true, reason: "no_eligible_matches" };
  }

  // Aggregate by franchiseeId: multiple file rows can map to the same franchisee
  // (e.g. מזרח ומערב Q1 2026 has both "אס.אף.אס" and "ויליג'" rows mapping to קינג קונג עפולה).
  const byFranchisee = new Map<
    string,
    {
      grossAmount: number;
      netAmount: number;
      preCalculatedCommission: number | undefined;
      sourceRowNumbers: number[];
    }
  >();

  for (const m of matches) {
    const id = m.matchedFranchiseeId!;
    const existing = byFranchisee.get(id);
    if (existing) {
      existing.grossAmount += m.grossAmount;
      existing.netAmount += m.netAmount;
      if (m.preCalculatedCommission !== undefined) {
        existing.preCalculatedCommission =
          (existing.preCalculatedCommission ?? 0) + m.preCalculatedCommission;
      }
      existing.sourceRowNumbers.push(m.rowNumber);
    } else {
      byFranchisee.set(id, {
        grossAmount: m.grossAmount,
        netAmount: m.netAmount,
        preCalculatedCommission: m.preCalculatedCommission,
        sourceRowNumbers: [m.rowNumber],
      });
    }
  }

  // Derive settlement period from file period + supplier frequency
  const periodStartDate = formatDateAsLocal(new Date(file.periodStartDate));
  const periodEndDate = formatDateAsLocal(new Date(file.periodEndDate));
  const frequency = (supplierRow.settlementFrequency ?? "quarterly") as SettlementPeriodType;
  const fiscalYearStartMonth = supplierRow.fiscalYearStartMonth ?? 1;
  const periodKey = derivePeriodKey(periodStartDate, frequency, fiscalYearStartMonth);

  let settlementPeriodId: string | undefined;
  if (periodKey) {
    const periodResult = await getOrCreateSettlementPeriodByPeriodKey(periodKey, userId);
    settlementPeriodId = periodResult?.settlementPeriod.id;
  }

  const transactions = Array.from(byFranchisee.entries()).map(([franchiseeId, agg]) => ({
    franchiseeId,
    grossAmount: agg.grossAmount,
    netAmount: agg.netAmount,
    vatAdjusted: supplierRow.vatIncluded ?? false,
    preCalculatedCommission: agg.preCalculatedCommission,
  }));

  const result = await calculateBatchCommissions({
    supplierId: file.supplierId,
    periodStartDate,
    periodEndDate,
    settlementPeriodId,
    sourceFileId: fileId,
    transactions,
    createdBy: userId,
  });

  return {
    created: result.totalCreated,
    failed: result.totalFailed,
    skipped: false,
  };
}
