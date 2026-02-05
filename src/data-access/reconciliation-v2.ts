/**
 * Data Access Layer for Reconciliation V2 Module
 *
 * Handles supplier vs franchisee amount reconciliation.
 * Uses a ₪30 threshold for auto-approval.
 */

import { database } from "@/db";
import {
  reconciliationSession,
  reconciliationComparison,
  reconciliationReviewQueue,
  supplier,
  supplierFileUpload,
  franchisee,
  uploadedFile,
  user,
  type ReconciliationSession,
  type ReconciliationComparison,
  type ReconciliationReviewQueue,
  type CreateReconciliationSessionData,
  type CreateReconciliationComparisonData,
  type CreateReconciliationReviewQueueData,
  type ReconciliationComparisonStatus,
  type SupplierFileProcessingResult,
  type BkmvProcessingResult,
} from "@/db/schema";
import { eq, and, desc, sql, count, gte, lte, or, ne, isNotNull } from "drizzle-orm";
import { getAmountForPeriod } from "@/lib/bkmvdata-parser";
import { getVatRateForDate, DEFAULT_VAT_RATE } from "@/data-access/vatRates";
import { calculateNetFromGross, roundToTwoDecimals } from "@/lib/file-processor";
import { getDatabaseError } from "@/lib/drizzle-errors";

// ============================================================================
// CONSTANTS
// ============================================================================

// Threshold for auto-approval (in NIS)
export const RECONCILIATION_THRESHOLD = 30;

// ============================================================================
// TYPES
// ============================================================================

// Extended supplier type with file info for selection
export type SupplierWithFileInfo = {
  id: string;
  name: string;
  code: string;
  fileCount: number;
  lastFileDate: Date | null;
};

// Period info for a supplier
export type SupplierPeriod = {
  periodKey: string; // Format: "YYYY-MM-DD_YYYY-MM-DD"
  periodStartDate: string;
  periodEndDate: string;
  supplierFileId: string;
  supplierFileName: string;
  uploadedAt: Date;
  hasExistingSession: boolean;
  existingSessionId: string | null;
  existingSessionStatus: string | null;
};

// Session with details
export type ReconciliationSessionWithDetails = ReconciliationSession & {
  supplierName: string;
  supplierCode: string;
  supplierFileName: string;
};

// Comparison with franchisee info
export type ReconciliationComparisonWithDetails = ReconciliationComparison & {
  franchiseeName: string;
  franchiseeCode: string;
  brandName: string | null;
};

// Review queue item (already has denormalized data)
export type ReconciliationReviewQueueItem = ReconciliationReviewQueue;

// History item for display
export type ReconciliationHistoryItem = {
  id: string;
  sessionId: string;
  supplierId: string;
  supplierName: string;
  franchiseeId: string;
  franchiseeName: string;
  periodStartDate: string;
  periodEndDate: string;
  supplierAmount: string;
  franchiseeAmount: string;
  difference: string;
  status: string;
  reviewedAt: Date | null;
  reviewedByName: string | null;
  reviewNotes: string | null;
};

// ============================================================================
// SUPPLIER SELECTION QUERIES
// ============================================================================

/**
 * Get all suppliers that have uploaded files (for dropdown selection)
 */
export async function getSuppliersWithFiles(): Promise<SupplierWithFileInfo[]> {
  const results = await database
    .select({
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
      fileCount: sql<number>`COUNT(${supplierFileUpload.id})::int`,
      lastFileDate: sql<Date>`MAX(${supplierFileUpload.createdAt})`,
    })
    .from(supplier)
    .innerJoin(supplierFileUpload, eq(supplier.id, supplierFileUpload.supplierId))
    .where(
      and(
        eq(supplier.isActive, true),
        eq(supplier.isHidden, false),
        // Only include files that are not rejected
        ne(supplierFileUpload.processingStatus, "rejected")
      )
    )
    .groupBy(supplier.id, supplier.name, supplier.code)
    .orderBy(supplier.name);

  return results;
}

/**
 * Get available periods for a supplier (periods with uploaded files)
 * Returns only the LATEST file for each unique period
 */
export async function getSupplierPeriods(supplierId: string): Promise<SupplierPeriod[]> {
  // Get all non-rejected supplier files for this supplier
  const files = await database
    .select({
      id: supplierFileUpload.id,
      periodStartDate: supplierFileUpload.periodStartDate,
      periodEndDate: supplierFileUpload.periodEndDate,
      originalFileName: supplierFileUpload.originalFileName,
      createdAt: supplierFileUpload.createdAt,
    })
    .from(supplierFileUpload)
    .where(
      and(
        eq(supplierFileUpload.supplierId, supplierId),
        ne(supplierFileUpload.processingStatus, "rejected")
      )
    )
    .orderBy(desc(supplierFileUpload.createdAt)); // Order by upload date to get latest first

  // Group by period and keep only the latest file for each period
  const latestByPeriod = new Map<string, typeof files[0]>();
  for (const file of files) {
    if (!file.periodStartDate || !file.periodEndDate) continue;
    const periodKey = `${file.periodStartDate}_${file.periodEndDate}`;
    // First file we encounter for this period is the latest (due to ORDER BY)
    if (!latestByPeriod.has(periodKey)) {
      latestByPeriod.set(periodKey, file);
    }
  }

  // Check which periods already have sessions
  const existingSessions = await database
    .select({
      id: reconciliationSession.id,
      periodStartDate: reconciliationSession.periodStartDate,
      periodEndDate: reconciliationSession.periodEndDate,
      status: reconciliationSession.status,
    })
    .from(reconciliationSession)
    .where(eq(reconciliationSession.supplierId, supplierId));

  const sessionMap = new Map(
    existingSessions.map((s) => [
      `${s.periodStartDate}_${s.periodEndDate}`,
      { id: s.id, status: s.status },
    ])
  );

  // Convert to array and sort by period start date (newest first)
  return Array.from(latestByPeriod.values())
    .sort((a, b) => b.periodStartDate!.localeCompare(a.periodStartDate!))
    .map((file) => {
      const periodKey = `${file.periodStartDate}_${file.periodEndDate}`;
      const existingSession = sessionMap.get(periodKey);

      return {
        periodKey,
        periodStartDate: file.periodStartDate!,
        periodEndDate: file.periodEndDate!,
        supplierFileId: file.id,
        supplierFileName: file.originalFileName,
        uploadedAt: file.createdAt,
        hasExistingSession: !!existingSession,
        existingSessionId: existingSession?.id || null,
        existingSessionStatus: existingSession?.status || null,
      };
    });
}

// ============================================================================
// SESSION MANAGEMENT
// ============================================================================

/**
 * Create a new reconciliation session with comparisons
 */
export async function createReconciliationSession(
  supplierId: string,
  supplierFileId: string,
  periodStartDate: string,
  periodEndDate: string,
  createdBy: string
): Promise<ReconciliationSessionWithDetails | null> {
  // Get supplier info
  const supplierData = await database
    .select({
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
      vatExempt: supplier.vatExempt,
    })
    .from(supplier)
    .where(eq(supplier.id, supplierId))
    .limit(1);

  if (!supplierData.length) return null;

  // Get supplier file with processing result
  const supplierFileData = await database
    .select({
      id: supplierFileUpload.id,
      originalFileName: supplierFileUpload.originalFileName,
      processingResult: supplierFileUpload.processingResult,
    })
    .from(supplierFileUpload)
    .where(eq(supplierFileUpload.id, supplierFileId))
    .limit(1);

  if (!supplierFileData.length || !supplierFileData[0].processingResult) return null;

  const processingResult = supplierFileData[0].processingResult as SupplierFileProcessingResult;

  // Get VAT rate for the period (use period start date)
  // BKMV amounts include VAT, so we need to convert to net amounts for comparison
  const periodDate = new Date(periodStartDate);
  const vatRate = await getVatRateForDate(periodDate);

  // Build franchisee amount map from year-based BKMV archive (preferred)
  // Falls back to uploaded_file records if year table has no data
  const franchiseeAmounts = new Map<
    string,
    { amount: number; fileId: string | null }
  >();

  // Try year-based table first
  const { getAllFranchiseeAmountsFromYearTable } = await import("@/data-access/franchisee-bkmv-year");
  const yearAmounts = await getAllFranchiseeAmountsFromYearTable(
    supplierId,
    periodStartDate,
    periodEndDate
  );

  if (yearAmounts.size > 0) {
    // Use year table data - apply VAT conversion
    for (const [fId, data] of yearAmounts) {
      const netAmount = supplierData[0].vatExempt
        ? roundToTwoDecimals(data.amount)
        : roundToTwoDecimals(calculateNetFromGross(data.amount, vatRate));
      franchiseeAmounts.set(fId, { amount: netAmount, fileId: data.fileId });
    }
  } else {
    // Fallback: query uploaded_file records (legacy path, pre-migration)
    const allFranchiseeFiles = await database
      .select({
        id: uploadedFile.id,
        franchiseeId: uploadedFile.franchiseeId,
        bkmvProcessingResult: uploadedFile.bkmvProcessingResult,
        filePeriodStart: uploadedFile.periodStartDate,
        filePeriodEnd: uploadedFile.periodEndDate,
        createdAt: uploadedFile.createdAt,
      })
      .from(uploadedFile)
      .where(
        and(
          isNotNull(uploadedFile.franchiseeId),
          isNotNull(uploadedFile.bkmvProcessingResult),
          lte(uploadedFile.periodStartDate, periodEndDate),
          gte(uploadedFile.periodEndDate, periodStartDate),
          or(
            eq(uploadedFile.processingStatus, "approved"),
            eq(uploadedFile.processingStatus, "auto_approved")
          )
        )
      );

    const latestFileByFranchisee = new Map<string, typeof allFranchiseeFiles[number]>();
    for (const file of allFranchiseeFiles) {
      if (!file.franchiseeId) continue;
      const existing = latestFileByFranchisee.get(file.franchiseeId);
      if (!existing || (file.createdAt && existing.createdAt && file.createdAt > existing.createdAt)) {
        latestFileByFranchisee.set(file.franchiseeId, file);
      }
    }

    for (const file of latestFileByFranchisee.values()) {
      if (!file.franchiseeId || !file.bkmvProcessingResult) continue;
      const bkmvResult = file.bkmvProcessingResult as BkmvProcessingResult;
      if (!bkmvResult.supplierMatches) continue;

      if (bkmvResult.monthlyBreakdown) {
        const periodAmount = getAmountForPeriod(
          bkmvResult.monthlyBreakdown,
          supplierId,
          periodStartDate,
          periodEndDate
        );
        if (periodAmount !== null) {
          const netAmount = supplierData[0].vatExempt
            ? roundToTwoDecimals(periodAmount)
            : roundToTwoDecimals(calculateNetFromGross(periodAmount, vatRate));
          franchiseeAmounts.set(file.franchiseeId, { amount: netAmount, fileId: file.id });
          continue;
        }
      }

      if (file.filePeriodStart === periodStartDate && file.filePeriodEnd === periodEndDate) {
        for (const match of bkmvResult.supplierMatches) {
          if (match.matchedSupplierId === supplierId) {
            const netAmount = supplierData[0].vatExempt
              ? roundToTwoDecimals(match.amount)
              : roundToTwoDecimals(calculateNetFromGross(match.amount, vatRate));
            franchiseeAmounts.set(file.franchiseeId, { amount: netAmount, fileId: file.id });
          }
        }
      }
    }
  }

  // Deduplicate franchisee matches: aggregate amounts when multiple supplier entries
  // map to the same franchisee (e.g., different aliases for the same restaurant)
  const comparisonMap = new Map<
    string,
    {
      supplierAmount: number;
      franchiseeAmount: number;
      supplierOriginalName: string;
      franchiseeFileId: string | null;
    }
  >();

  for (const match of processingResult.franchiseeMatches) {
    if (!match.matchedFranchiseeId || match.matchType === "blacklisted") continue;

    // For vatExempt suppliers: use grossAmount which includes per-item VAT
    // (for truly exempt suppliers, gross=net so this is safe).
    // For normal suppliers: use netAmount for comparison against BKMV net.
    const supplierAmount = supplierData[0].vatExempt
      ? (match.grossAmount || match.netAmount)
      : (match.netAmount || match.grossAmount);
    const franchiseeData = franchiseeAmounts.get(match.matchedFranchiseeId);
    const franchiseeAmount = franchiseeData?.amount || 0;

    const existing = comparisonMap.get(match.matchedFranchiseeId);
    if (existing) {
      // Aggregate: add supplier amount to existing entry
      existing.supplierAmount += supplierAmount;
      existing.supplierOriginalName = `${existing.supplierOriginalName}, ${match.originalName}`;
    } else {
      comparisonMap.set(match.matchedFranchiseeId, {
        supplierAmount,
        franchiseeAmount,
        supplierOriginalName: match.originalName,
        franchiseeFileId: franchiseeData?.fileId || null,
      });
    }
  }

  // Build final comparisons from deduped map and compute stats
  let totalSupplierAmount = 0;
  let totalFranchiseeAmount = 0;
  let matchedCount = 0;
  let needsReviewCount = 0;

  // We'll fill in sessionId inside the transaction
  const comparisonEntries: Array<{
    franchiseeId: string;
    supplierAmount: number;
    franchiseeAmount: number;
    difference: number;
    absoluteDifference: number;
    supplierOriginalName: string;
    franchiseeFileId: string | null;
    status: ReconciliationComparisonStatus;
  }> = [];

  for (const [franchiseeId, data] of comparisonMap) {
    const difference = data.supplierAmount - data.franchiseeAmount;
    const absoluteDifference = Math.abs(difference);

    let status: ReconciliationComparisonStatus;
    if (absoluteDifference <= RECONCILIATION_THRESHOLD) {
      status = "auto_approved";
      matchedCount++;
    } else {
      status = "needs_review";
      needsReviewCount++;
    }

    comparisonEntries.push({
      franchiseeId,
      supplierAmount: data.supplierAmount,
      franchiseeAmount: data.franchiseeAmount,
      difference,
      absoluteDifference,
      supplierOriginalName: data.supplierOriginalName,
      franchiseeFileId: data.franchiseeFileId,
      status,
    });

    totalSupplierAmount += data.supplierAmount;
    totalFranchiseeAmount += data.franchiseeAmount;
  }

  const totalDifference = totalSupplierAmount - totalFranchiseeAmount;

  // Wrap session + comparisons + stats update in a single transaction
  // to prevent orphaned sessions if comparison insert fails
  let newSession: ReconciliationSession;
  try {
    newSession = await database.transaction(async (tx) => {
      const [session] = await tx
        .insert(reconciliationSession)
        .values({
          supplierId,
          supplierFileId,
          periodStartDate,
          periodEndDate,
          status: "in_progress",
          createdBy,
        })
        .returning();

      if (comparisonEntries.length > 0) {
        const comparisons: CreateReconciliationComparisonData[] = comparisonEntries.map((entry) => ({
          sessionId: session.id,
          franchiseeId: entry.franchiseeId,
          supplierAmount: entry.supplierAmount.toString(),
          franchiseeAmount: entry.franchiseeAmount.toString(),
          difference: entry.difference.toString(),
          absoluteDifference: entry.absoluteDifference.toString(),
          supplierOriginalName: entry.supplierOriginalName,
          franchiseeFileId: entry.franchiseeFileId,
          status: entry.status,
        }));

        await tx.insert(reconciliationComparison).values(comparisons);
      }

      await tx
        .update(reconciliationSession)
        .set({
          totalFranchisees: comparisonEntries.length,
          matchedCount,
          needsReviewCount,
          approvedCount: matchedCount, // Auto-approved counts as approved
          totalSupplierAmount: totalSupplierAmount.toString(),
          totalFranchiseeAmount: totalFranchiseeAmount.toString(),
          totalDifference: totalDifference.toString(),
          updatedAt: new Date(),
        })
        .where(eq(reconciliationSession.id, session.id));

      return session;
    });
  } catch (error) {
    const dbError = getDatabaseError(error);
    console.error("[createReconciliationSession] Transaction failed:", {
      supplierId,
      supplierFileId,
      periodStartDate,
      periodEndDate,
      pgCode: dbError.code,
      pgConstraint: dbError.constraint,
      pgDetail: dbError.detail,
      pgMessage: dbError.message,
    });
    throw error;
  }

  return {
    ...newSession,
    totalFranchisees: comparisonEntries.length,
    matchedCount,
    needsReviewCount,
    approvedCount: matchedCount,
    totalSupplierAmount: totalSupplierAmount.toString(),
    totalFranchiseeAmount: totalFranchiseeAmount.toString(),
    totalDifference: totalDifference.toString(),
    supplierName: supplierData[0].name,
    supplierCode: supplierData[0].code,
    supplierFileName: supplierFileData[0].originalFileName,
  };
}

/**
 * Get session by ID with details
 */
export async function getSessionById(
  sessionId: string
): Promise<ReconciliationSessionWithDetails | null> {
  const results = await database
    .select({
      id: reconciliationSession.id,
      supplierId: reconciliationSession.supplierId,
      supplierFileId: reconciliationSession.supplierFileId,
      periodStartDate: reconciliationSession.periodStartDate,
      periodEndDate: reconciliationSession.periodEndDate,
      status: reconciliationSession.status,
      totalFranchisees: reconciliationSession.totalFranchisees,
      matchedCount: reconciliationSession.matchedCount,
      needsReviewCount: reconciliationSession.needsReviewCount,
      approvedCount: reconciliationSession.approvedCount,
      toReviewQueueCount: reconciliationSession.toReviewQueueCount,
      totalSupplierAmount: reconciliationSession.totalSupplierAmount,
      totalFranchiseeAmount: reconciliationSession.totalFranchiseeAmount,
      totalDifference: reconciliationSession.totalDifference,
      fileRejectionReason: reconciliationSession.fileRejectionReason,
      fileApprovedAt: reconciliationSession.fileApprovedAt,
      fileApprovedBy: reconciliationSession.fileApprovedBy,
      createdAt: reconciliationSession.createdAt,
      updatedAt: reconciliationSession.updatedAt,
      createdBy: reconciliationSession.createdBy,
      supplierName: supplier.name,
      supplierCode: supplier.code,
      supplierFileName: supplierFileUpload.originalFileName,
    })
    .from(reconciliationSession)
    .innerJoin(supplier, eq(reconciliationSession.supplierId, supplier.id))
    .innerJoin(supplierFileUpload, eq(reconciliationSession.supplierFileId, supplierFileUpload.id))
    .where(eq(reconciliationSession.id, sessionId))
    .limit(1);

  return results.length > 0 ? results[0] : null;
}

/**
 * Get session with all comparisons
 */
export async function getSessionWithComparisons(sessionId: string): Promise<{
  session: ReconciliationSessionWithDetails;
  comparisons: ReconciliationComparisonWithDetails[];
} | null> {
  const session = await getSessionById(sessionId);
  if (!session) return null;

  const comparisons = await database
    .select({
      id: reconciliationComparison.id,
      sessionId: reconciliationComparison.sessionId,
      franchiseeId: reconciliationComparison.franchiseeId,
      supplierAmount: reconciliationComparison.supplierAmount,
      franchiseeAmount: reconciliationComparison.franchiseeAmount,
      difference: reconciliationComparison.difference,
      absoluteDifference: reconciliationComparison.absoluteDifference,
      supplierOriginalName: reconciliationComparison.supplierOriginalName,
      franchiseeFileId: reconciliationComparison.franchiseeFileId,
      status: reconciliationComparison.status,
      reviewedBy: reconciliationComparison.reviewedBy,
      reviewedAt: reconciliationComparison.reviewedAt,
      reviewNotes: reconciliationComparison.reviewNotes,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      brandName: sql<string | null>`(SELECT name_he FROM brand WHERE id = ${franchisee.brandId})`,
    })
    .from(reconciliationComparison)
    .innerJoin(franchisee, eq(reconciliationComparison.franchiseeId, franchisee.id))
    .where(eq(reconciliationComparison.sessionId, sessionId))
    .orderBy(desc(reconciliationComparison.absoluteDifference));

  return { session, comparisons };
}

// ============================================================================
// COMPARISON STATUS UPDATES
// ============================================================================

/**
 * Update a single comparison status
 */
export async function updateComparisonStatus(
  comparisonId: string,
  status: ReconciliationComparisonStatus,
  reviewedBy: string,
  notes?: string
): Promise<ReconciliationComparison | null> {
  const [updated] = await database
    .update(reconciliationComparison)
    .set({
      status,
      reviewedBy,
      reviewedAt: new Date(),
      reviewNotes: notes || null,
    })
    .where(eq(reconciliationComparison.id, comparisonId))
    .returning();

  if (updated) {
    // Update session statistics
    await recalculateSessionStats(updated.sessionId);
  }

  return updated || null;
}

/**
 * Bulk approve comparisons
 */
export async function bulkApproveComparisons(
  comparisonIds: string[],
  reviewedBy: string
): Promise<number> {
  if (comparisonIds.length === 0) return 0;

  const result = await database
    .update(reconciliationComparison)
    .set({
      status: "manually_approved",
      reviewedBy,
      reviewedAt: new Date(),
    })
    .where(
      and(
        sql`${reconciliationComparison.id} = ANY(${comparisonIds})`,
        eq(reconciliationComparison.status, "needs_review")
      )
    )
    .returning({ sessionId: reconciliationComparison.sessionId });

  // Get unique session IDs and recalculate stats
  const sessionIds = [...new Set(result.map((r) => r.sessionId))];
  for (const sessionId of sessionIds) {
    await recalculateSessionStats(sessionId);
  }

  return result.length;
}

/**
 * Add a comparison to the review queue
 */
export async function addToReviewQueue(
  comparisonId: string,
  sessionId: string
): Promise<ReconciliationReviewQueue | null> {
  // Get comparison with details
  const comparison = await database
    .select({
      id: reconciliationComparison.id,
      sessionId: reconciliationComparison.sessionId,
      franchiseeId: reconciliationComparison.franchiseeId,
      supplierAmount: reconciliationComparison.supplierAmount,
      franchiseeAmount: reconciliationComparison.franchiseeAmount,
      difference: reconciliationComparison.difference,
      franchiseeName: franchisee.name,
    })
    .from(reconciliationComparison)
    .innerJoin(franchisee, eq(reconciliationComparison.franchiseeId, franchisee.id))
    .where(eq(reconciliationComparison.id, comparisonId))
    .limit(1);

  if (!comparison.length) return null;

  // Get session info
  const session = await database
    .select({
      supplierId: reconciliationSession.supplierId,
      periodStartDate: reconciliationSession.periodStartDate,
      periodEndDate: reconciliationSession.periodEndDate,
      supplierName: supplier.name,
    })
    .from(reconciliationSession)
    .innerJoin(supplier, eq(reconciliationSession.supplierId, supplier.id))
    .where(eq(reconciliationSession.id, sessionId))
    .limit(1);

  if (!session.length) return null;

  // Update comparison status
  await database
    .update(reconciliationComparison)
    .set({ status: "sent_to_review_queue" })
    .where(eq(reconciliationComparison.id, comparisonId));

  // Create review queue entry
  const [queueItem] = await database
    .insert(reconciliationReviewQueue)
    .values({
      comparisonId,
      sessionId,
      supplierId: session[0].supplierId,
      supplierName: session[0].supplierName,
      franchiseeId: comparison[0].franchiseeId,
      franchiseeName: comparison[0].franchiseeName,
      periodStartDate: session[0].periodStartDate,
      periodEndDate: session[0].periodEndDate,
      supplierAmount: comparison[0].supplierAmount,
      franchiseeAmount: comparison[0].franchiseeAmount,
      difference: comparison[0].difference,
      status: "pending",
    })
    .returning();

  // Update session stats
  await recalculateSessionStats(sessionId);

  return queueItem;
}

// ============================================================================
// REVIEW QUEUE
// ============================================================================

/**
 * Get all pending review queue items
 */
export async function getReviewQueueItems(): Promise<ReconciliationReviewQueueItem[]> {
  return database
    .select()
    .from(reconciliationReviewQueue)
    .where(eq(reconciliationReviewQueue.status, "pending"))
    .orderBy(desc(reconciliationReviewQueue.createdAt));
}

/**
 * Get review queue count (for sidebar badge)
 */
export async function getReviewQueueCount(): Promise<number> {
  const result = await database
    .select({ count: count() })
    .from(reconciliationReviewQueue)
    .where(eq(reconciliationReviewQueue.status, "pending"));

  return result[0]?.count || 0;
}

/**
 * Resolve a review queue item
 */
export async function resolveReviewQueueItem(
  queueItemId: string,
  resolvedBy: string,
  notes?: string
): Promise<ReconciliationReviewQueue | null> {
  // Get the queue item
  const queueItem = await database
    .select()
    .from(reconciliationReviewQueue)
    .where(eq(reconciliationReviewQueue.id, queueItemId))
    .limit(1);

  if (!queueItem.length) return null;

  // Update queue item
  const [updated] = await database
    .update(reconciliationReviewQueue)
    .set({
      status: "resolved",
      resolvedBy,
      resolvedAt: new Date(),
      resolutionNotes: notes || null,
    })
    .where(eq(reconciliationReviewQueue.id, queueItemId))
    .returning();

  // Update the associated comparison
  await database
    .update(reconciliationComparison)
    .set({
      status: "manually_approved",
      reviewedBy: resolvedBy,
      reviewedAt: new Date(),
      reviewNotes: notes || null,
    })
    .where(eq(reconciliationComparison.id, queueItem[0].comparisonId));

  // Update session stats
  await recalculateSessionStats(queueItem[0].sessionId);

  return updated;
}

// ============================================================================
// SESSION STATUS
// ============================================================================

/**
 * Approve the supplier file (mark session as file_approved)
 */
export async function approveSessionFile(
  sessionId: string,
  approvedBy: string
): Promise<ReconciliationSession | null> {
  const [updated] = await database
    .update(reconciliationSession)
    .set({
      status: "file_approved",
      fileApprovedAt: new Date(),
      fileApprovedBy: approvedBy,
      updatedAt: new Date(),
    })
    .where(eq(reconciliationSession.id, sessionId))
    .returning();

  return updated || null;
}

/**
 * Reject the supplier file with reason
 */
export async function rejectSessionFile(
  sessionId: string,
  rejectedBy: string,
  reason: string
): Promise<ReconciliationSession | null> {
  const [updated] = await database
    .update(reconciliationSession)
    .set({
      status: "file_rejected",
      fileRejectionReason: reason,
      fileApprovedBy: rejectedBy, // Reusing field to track who rejected
      fileApprovedAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(reconciliationSession.id, sessionId))
    .returning();

  return updated || null;
}

// ============================================================================
// HISTORY
// ============================================================================

/**
 * Get reconciliation history with filters
 */
export async function getReconciliationHistory(filters?: {
  supplierId?: string;
  franchiseeId?: string;
  periodStartDate?: string;
  periodEndDate?: string;
  limit?: number;
  offset?: number;
}): Promise<{ items: ReconciliationHistoryItem[]; total: number }> {
  const conditions = [];

  if (filters?.supplierId) {
    conditions.push(eq(reconciliationSession.supplierId, filters.supplierId));
  }

  if (filters?.franchiseeId) {
    conditions.push(eq(reconciliationComparison.franchiseeId, filters.franchiseeId));
  }

  if (filters?.periodStartDate) {
    conditions.push(gte(reconciliationSession.periodStartDate, filters.periodStartDate));
  }

  if (filters?.periodEndDate) {
    conditions.push(lte(reconciliationSession.periodEndDate, filters.periodEndDate));
  }

  const whereClause = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count
  const countResult = await database
    .select({ count: count() })
    .from(reconciliationComparison)
    .innerJoin(
      reconciliationSession,
      eq(reconciliationComparison.sessionId, reconciliationSession.id)
    )
    .where(whereClause);

  const total = countResult[0]?.count || 0;

  // Get items
  let query = database
    .select({
      id: reconciliationComparison.id,
      sessionId: reconciliationComparison.sessionId,
      supplierId: reconciliationSession.supplierId,
      supplierName: supplier.name,
      franchiseeId: reconciliationComparison.franchiseeId,
      franchiseeName: franchisee.name,
      periodStartDate: reconciliationSession.periodStartDate,
      periodEndDate: reconciliationSession.periodEndDate,
      supplierAmount: reconciliationComparison.supplierAmount,
      franchiseeAmount: reconciliationComparison.franchiseeAmount,
      difference: reconciliationComparison.difference,
      status: reconciliationComparison.status,
      reviewedAt: reconciliationComparison.reviewedAt,
      reviewedByName: user.name,
      reviewNotes: reconciliationComparison.reviewNotes,
    })
    .from(reconciliationComparison)
    .innerJoin(
      reconciliationSession,
      eq(reconciliationComparison.sessionId, reconciliationSession.id)
    )
    .innerJoin(supplier, eq(reconciliationSession.supplierId, supplier.id))
    .innerJoin(franchisee, eq(reconciliationComparison.franchiseeId, franchisee.id))
    .leftJoin(user, eq(reconciliationComparison.reviewedBy, user.id))
    .where(whereClause)
    .orderBy(desc(reconciliationComparison.reviewedAt))
    .$dynamic();

  if (filters?.limit) {
    query = query.limit(filters.limit);
  }

  if (filters?.offset) {
    query = query.offset(filters.offset);
  }

  const items = await query;

  return { items, total };
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Recalculate session statistics after comparison updates
 */
async function recalculateSessionStats(sessionId: string): Promise<void> {
  const comparisons = await database
    .select({
      status: reconciliationComparison.status,
    })
    .from(reconciliationComparison)
    .where(eq(reconciliationComparison.sessionId, sessionId));

  let matchedCount = 0;
  let needsReviewCount = 0;
  let approvedCount = 0;
  let toReviewQueueCount = 0;

  for (const c of comparisons) {
    if (c.status === "auto_approved") {
      matchedCount++;
      approvedCount++;
    } else if (c.status === "manually_approved") {
      approvedCount++;
    } else if (c.status === "needs_review") {
      needsReviewCount++;
    } else if (c.status === "sent_to_review_queue") {
      toReviewQueueCount++;
    }
  }

  // Determine session status
  let sessionStatus: "in_progress" | "completed" = "in_progress";
  if (needsReviewCount === 0 && toReviewQueueCount === 0) {
    sessionStatus = "completed";
  }

  await database
    .update(reconciliationSession)
    .set({
      totalFranchisees: comparisons.length,
      matchedCount,
      needsReviewCount,
      approvedCount,
      toReviewQueueCount,
      status: sessionStatus,
      updatedAt: new Date(),
    })
    .where(eq(reconciliationSession.id, sessionId));
}

/**
 * Delete a session and all related data
 */
export async function deleteSession(sessionId: string): Promise<boolean> {
  const result = await database
    .delete(reconciliationSession)
    .where(eq(reconciliationSession.id, sessionId));

  return (result.rowCount ?? 0) > 0;
}

/**
 * Get all sessions with supplier info
 */
export async function getAllSessions(filters?: {
  status?: string;
  supplierId?: string;
  limit?: number;
}): Promise<ReconciliationSessionWithDetails[]> {
  let query = database
    .select({
      id: reconciliationSession.id,
      supplierId: reconciliationSession.supplierId,
      supplierFileId: reconciliationSession.supplierFileId,
      periodStartDate: reconciliationSession.periodStartDate,
      periodEndDate: reconciliationSession.periodEndDate,
      status: reconciliationSession.status,
      totalFranchisees: reconciliationSession.totalFranchisees,
      matchedCount: reconciliationSession.matchedCount,
      needsReviewCount: reconciliationSession.needsReviewCount,
      approvedCount: reconciliationSession.approvedCount,
      toReviewQueueCount: reconciliationSession.toReviewQueueCount,
      totalSupplierAmount: reconciliationSession.totalSupplierAmount,
      totalFranchiseeAmount: reconciliationSession.totalFranchiseeAmount,
      totalDifference: reconciliationSession.totalDifference,
      fileRejectionReason: reconciliationSession.fileRejectionReason,
      fileApprovedAt: reconciliationSession.fileApprovedAt,
      fileApprovedBy: reconciliationSession.fileApprovedBy,
      createdAt: reconciliationSession.createdAt,
      updatedAt: reconciliationSession.updatedAt,
      createdBy: reconciliationSession.createdBy,
      supplierName: supplier.name,
      supplierCode: supplier.code,
      supplierFileName: supplierFileUpload.originalFileName,
    })
    .from(reconciliationSession)
    .innerJoin(supplier, eq(reconciliationSession.supplierId, supplier.id))
    .innerJoin(supplierFileUpload, eq(reconciliationSession.supplierFileId, supplierFileUpload.id))
    .orderBy(desc(reconciliationSession.createdAt))
    .$dynamic();

  const conditions = [];
  if (filters?.status) {
    conditions.push(eq(reconciliationSession.status, filters.status as "in_progress" | "completed" | "file_approved" | "file_rejected"));
  }
  if (filters?.supplierId) {
    conditions.push(eq(reconciliationSession.supplierId, filters.supplierId));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  if (filters?.limit) {
    query = query.limit(filters.limit);
  }

  return query;
}
