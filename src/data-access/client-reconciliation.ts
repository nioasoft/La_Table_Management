/**
 * Data Access Layer for Client Reconciliation
 *
 * Compares client-reported amounts against Tabit POS reports per franchisee.
 * Uses ₪30 threshold for auto-approval (same as supplier reconciliation).
 */

import { database } from "@/db";
import {
  clientReconciliationSession,
  clientReconciliationComparison,
  clientDocument,
  clientFranchisee,
  client,
  franchisee,
  user,
  type ClientReconciliationSession,
  type ClientReconciliationComparison,
  type ReconciliationComparisonStatus,
} from "@/db/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";

// ============================================================================
// CONSTANTS
// ============================================================================

export const CLIENT_RECONCILIATION_THRESHOLD = 30; // NIS

// ============================================================================
// TYPES
// ============================================================================

export type ClientReconciliationSessionWithDetails = ClientReconciliationSession & {
  clientName: string;
  clientCode: string | null;
};

export type ClientReconciliationComparisonWithDetails = ClientReconciliationComparison & {
  franchiseeName: string;
  franchiseeCode: string;
  clientDocFileName: string | null;
  tabitDocFileName: string | null;
};

// ============================================================================
// SESSION OPERATIONS
// ============================================================================

/**
 * Create a client reconciliation session.
 *
 * Fetches all franchisees linked to the client, finds their documents
 * for the period, and creates comparisons.
 */
export async function createClientReconciliationSession(
  clientId: string,
  periodMonth: number,
  periodYear: number,
  createdBy: string
): Promise<ClientReconciliationSessionWithDetails> {
  // Get client info
  const [clientRow] = await database
    .select({ id: client.id, name: client.name, code: client.code })
    .from(client)
    .where(eq(client.id, clientId))
    .limit(1);

  if (!clientRow) throw new Error("לקוח לא נמצא");

  // Get linked franchisees
  const linkedFranchisees = await database
    .select({
      franchiseeId: clientFranchisee.franchiseeId,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
    })
    .from(clientFranchisee)
    .innerJoin(franchisee, eq(clientFranchisee.franchiseeId, franchisee.id))
    .where(
      and(
        eq(clientFranchisee.clientId, clientId),
        eq(franchisee.isActive, true)
      )
    );

  if (linkedFranchisees.length === 0) {
    throw new Error("אין זכיינים משויכים ללקוח זה");
  }

  const franchiseeIds = linkedFranchisees.map((f) => f.franchiseeId);

  // Get all documents for this period
  const docs = await database
    .select({
      id: clientDocument.id,
      clientId: clientDocument.clientId,
      franchiseeId: clientDocument.franchiseeId,
      documentType: clientDocument.documentType,
      totalAmount: clientDocument.totalAmount,
      commissionAmount: clientDocument.commissionAmount,
      commissionRate: clientDocument.commissionRate,
      netAmount: clientDocument.netAmount,
      originalFileName: clientDocument.originalFileName,
    })
    .from(clientDocument)
    .where(
      and(
        eq(clientDocument.periodMonth, periodMonth),
        eq(clientDocument.periodYear, periodYear),
        inArray(clientDocument.franchiseeId, franchiseeIds)
      )
    );

  // Build lookup maps
  const clientDocs = new Map<string, typeof docs[0]>();
  const tabitDocs = new Map<string, typeof docs[0]>();
  for (const doc of docs) {
    if (doc.documentType === "client_report" && doc.clientId === clientId) {
      clientDocs.set(doc.franchiseeId, doc);
    } else if (doc.documentType === "tabit_report") {
      tabitDocs.set(doc.franchiseeId, doc);
    }
  }

  // Get expected commission rates from client config
  const [clientConfig] = await database
    .select({
      posTerminalCommission: client.posTerminalCommission,
      dineInCommission: client.dineInCommission,
      deliveryCommission: client.deliveryCommission,
    })
    .from(client)
    .where(eq(client.id, clientId))
    .limit(1);

  // Use the first non-null commission as default expected rate
  const expectedRate = parseFloat(
    clientConfig?.posTerminalCommission ??
    clientConfig?.dineInCommission ??
    clientConfig?.deliveryCommission ??
    "0"
  );

  // Create session
  const sessionId = crypto.randomUUID();

  // Build comparisons
  let matchedCount = 0;
  let needsReviewCount = 0;
  let totalClientAmount = 0;
  let totalTabitAmount = 0;

  const comparisons = linkedFranchisees.map((f) => {
    const clientDoc = clientDocs.get(f.franchiseeId);
    const tabitDoc = tabitDocs.get(f.franchiseeId);

    const clientAmount = clientDoc?.totalAmount ? parseFloat(clientDoc.totalAmount) : null;
    const tabitAmount = tabitDoc?.totalAmount ? parseFloat(tabitDoc.totalAmount) : null;

    const actualCommRate = clientDoc?.commissionRate
      ? parseFloat(clientDoc.commissionRate)
      : null;
    const commissionAmt = clientDoc?.commissionAmount
      ? parseFloat(clientDoc.commissionAmount)
      : null;
    const netAmt = clientDoc?.netAmount
      ? parseFloat(clientDoc.netAmount)
      : null;

    // Calculate difference (only if both sides have amounts)
    let difference: number | null = null;
    let absDifference: number | null = null;
    let status: ReconciliationComparisonStatus = "pending";

    if (clientAmount !== null && tabitAmount !== null) {
      difference = clientAmount - tabitAmount;
      absDifference = Math.abs(difference);

      if (absDifference <= CLIENT_RECONCILIATION_THRESHOLD) {
        status = "auto_approved";
        matchedCount++;
      } else {
        status = "needs_review";
        needsReviewCount++;
      }

      totalClientAmount += clientAmount;
      totalTabitAmount += tabitAmount;
    } else {
      // Missing one or both documents
      status = "needs_review";
      needsReviewCount++;
      if (clientAmount !== null) totalClientAmount += clientAmount;
      if (tabitAmount !== null) totalTabitAmount += tabitAmount;
    }

    return {
      id: crypto.randomUUID(),
      sessionId,
      franchiseeId: f.franchiseeId,
      clientDocumentId: clientDoc?.id ?? null,
      tabitDocumentId: tabitDoc?.id ?? null,
      clientAmount: clientAmount?.toString() ?? null,
      tabitAmount: tabitAmount?.toString() ?? null,
      difference: difference?.toString() ?? null,
      absoluteDifference: absDifference?.toString() ?? null,
      expectedCommissionRate: expectedRate?.toString() ?? null,
      actualCommissionRate: actualCommRate?.toString() ?? null,
      commissionAmount: commissionAmt?.toString() ?? null,
      netAmount: netAmt?.toString() ?? null,
      status,
    };
  });

  // Insert session + comparisons in transaction
  const totalDiff = totalClientAmount - totalTabitAmount;

  const [session] = await database
    .insert(clientReconciliationSession)
    .values({
      id: sessionId,
      clientId,
      periodMonth,
      periodYear,
      status: "in_progress",
      totalFranchisees: linkedFranchisees.length,
      matchedCount,
      needsReviewCount,
      approvedCount: matchedCount,
      totalClientAmount: totalClientAmount.toString(),
      totalTabitAmount: totalTabitAmount.toString(),
      totalDifference: totalDiff.toString(),
      createdBy,
    })
    .returning();

  if (comparisons.length > 0) {
    await database
      .insert(clientReconciliationComparison)
      .values(comparisons);
  }

  return {
    ...session,
    clientName: clientRow.name,
    clientCode: clientRow.code,
  };
}

/**
 * Get all sessions, optionally filtered by client
 */
export async function getClientReconciliationSessions(
  clientId?: string
): Promise<ClientReconciliationSessionWithDetails[]> {
  const conditions = [];
  if (clientId) {
    conditions.push(eq(clientReconciliationSession.clientId, clientId));
  }

  return database
    .select({
      id: clientReconciliationSession.id,
      clientId: clientReconciliationSession.clientId,
      periodMonth: clientReconciliationSession.periodMonth,
      periodYear: clientReconciliationSession.periodYear,
      status: clientReconciliationSession.status,
      totalFranchisees: clientReconciliationSession.totalFranchisees,
      matchedCount: clientReconciliationSession.matchedCount,
      needsReviewCount: clientReconciliationSession.needsReviewCount,
      approvedCount: clientReconciliationSession.approvedCount,
      totalClientAmount: clientReconciliationSession.totalClientAmount,
      totalTabitAmount: clientReconciliationSession.totalTabitAmount,
      totalDifference: clientReconciliationSession.totalDifference,
      fileApprovedAt: clientReconciliationSession.fileApprovedAt,
      fileApprovedBy: clientReconciliationSession.fileApprovedBy,
      fileRejectionReason: clientReconciliationSession.fileRejectionReason,
      createdAt: clientReconciliationSession.createdAt,
      updatedAt: clientReconciliationSession.updatedAt,
      createdBy: clientReconciliationSession.createdBy,
      clientName: client.name,
      clientCode: client.code,
    })
    .from(clientReconciliationSession)
    .innerJoin(client, eq(clientReconciliationSession.clientId, client.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(clientReconciliationSession.createdAt));
}

/**
 * Get a session with all its comparisons
 */
export async function getSessionWithComparisons(sessionId: string): Promise<{
  session: ClientReconciliationSessionWithDetails;
  comparisons: ClientReconciliationComparisonWithDetails[];
} | null> {
  const [session] = await database
    .select({
      id: clientReconciliationSession.id,
      clientId: clientReconciliationSession.clientId,
      periodMonth: clientReconciliationSession.periodMonth,
      periodYear: clientReconciliationSession.periodYear,
      status: clientReconciliationSession.status,
      totalFranchisees: clientReconciliationSession.totalFranchisees,
      matchedCount: clientReconciliationSession.matchedCount,
      needsReviewCount: clientReconciliationSession.needsReviewCount,
      approvedCount: clientReconciliationSession.approvedCount,
      totalClientAmount: clientReconciliationSession.totalClientAmount,
      totalTabitAmount: clientReconciliationSession.totalTabitAmount,
      totalDifference: clientReconciliationSession.totalDifference,
      fileApprovedAt: clientReconciliationSession.fileApprovedAt,
      fileApprovedBy: clientReconciliationSession.fileApprovedBy,
      fileRejectionReason: clientReconciliationSession.fileRejectionReason,
      createdAt: clientReconciliationSession.createdAt,
      updatedAt: clientReconciliationSession.updatedAt,
      createdBy: clientReconciliationSession.createdBy,
      clientName: client.name,
      clientCode: client.code,
    })
    .from(clientReconciliationSession)
    .innerJoin(client, eq(clientReconciliationSession.clientId, client.id))
    .where(eq(clientReconciliationSession.id, sessionId))
    .limit(1);

  if (!session) return null;

  const comparisons = await database
    .select({
      id: clientReconciliationComparison.id,
      sessionId: clientReconciliationComparison.sessionId,
      franchiseeId: clientReconciliationComparison.franchiseeId,
      clientDocumentId: clientReconciliationComparison.clientDocumentId,
      tabitDocumentId: clientReconciliationComparison.tabitDocumentId,
      clientAmount: clientReconciliationComparison.clientAmount,
      tabitAmount: clientReconciliationComparison.tabitAmount,
      difference: clientReconciliationComparison.difference,
      absoluteDifference: clientReconciliationComparison.absoluteDifference,
      expectedCommissionRate: clientReconciliationComparison.expectedCommissionRate,
      actualCommissionRate: clientReconciliationComparison.actualCommissionRate,
      commissionAmount: clientReconciliationComparison.commissionAmount,
      netAmount: clientReconciliationComparison.netAmount,
      status: clientReconciliationComparison.status,
      reviewedBy: clientReconciliationComparison.reviewedBy,
      reviewedAt: clientReconciliationComparison.reviewedAt,
      reviewNotes: clientReconciliationComparison.reviewNotes,
      notes: clientReconciliationComparison.notes,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      clientDocFileName: sql<string | null>`cd_client."original_file_name"`,
      tabitDocFileName: sql<string | null>`cd_tabit."original_file_name"`,
    })
    .from(clientReconciliationComparison)
    .innerJoin(
      franchisee,
      eq(clientReconciliationComparison.franchiseeId, franchisee.id)
    )
    .leftJoin(
      sql`"client_document" as cd_client`,
      sql`cd_client."id" = ${clientReconciliationComparison.clientDocumentId}`
    )
    .leftJoin(
      sql`"client_document" as cd_tabit`,
      sql`cd_tabit."id" = ${clientReconciliationComparison.tabitDocumentId}`
    )
    .where(eq(clientReconciliationComparison.sessionId, sessionId))
    .orderBy(franchisee.name);

  return { session, comparisons };
}

// ============================================================================
// COMPARISON OPERATIONS
// ============================================================================

/**
 * Update a single comparison's status
 */
export async function updateComparisonStatus(
  comparisonId: string,
  status: ReconciliationComparisonStatus,
  reviewedBy: string,
  reviewNotes?: string
): Promise<ClientReconciliationComparison> {
  const [updated] = await database
    .update(clientReconciliationComparison)
    .set({
      status,
      reviewedBy,
      reviewedAt: new Date(),
      reviewNotes: reviewNotes ?? null,
    })
    .where(eq(clientReconciliationComparison.id, comparisonId))
    .returning();

  // Recalculate session stats
  if (updated) {
    await recalculateSessionStats(updated.sessionId);
  }

  return updated;
}

/**
 * Approve all auto_approved + manually update session status
 */
export async function approveSession(
  sessionId: string,
  approvedBy: string
): Promise<ClientReconciliationSession> {
  // Mark all pending auto_approved comparisons
  const [session] = await database
    .update(clientReconciliationSession)
    .set({
      status: "file_approved",
      fileApprovedAt: new Date(),
      fileApprovedBy: approvedBy,
      updatedAt: new Date(),
    })
    .where(eq(clientReconciliationSession.id, sessionId))
    .returning();

  return session;
}

/**
 * Reject a session
 */
export async function rejectSession(
  sessionId: string,
  reason: string
): Promise<ClientReconciliationSession> {
  const [session] = await database
    .update(clientReconciliationSession)
    .set({
      status: "file_rejected",
      fileRejectionReason: reason,
      updatedAt: new Date(),
    })
    .where(eq(clientReconciliationSession.id, sessionId))
    .returning();

  return session;
}

// ============================================================================
// HELPERS
// ============================================================================

/**
 * Recalculate session statistics from its comparisons
 */
async function recalculateSessionStats(sessionId: string): Promise<void> {
  const stats = await database
    .select({
      total: sql<number>`count(*)`,
      matched: sql<number>`count(*) filter (where ${clientReconciliationComparison.status} in ('auto_approved', 'manually_approved'))`,
      needsReview: sql<number>`count(*) filter (where ${clientReconciliationComparison.status} = 'needs_review')`,
      approved: sql<number>`count(*) filter (where ${clientReconciliationComparison.status} in ('auto_approved', 'manually_approved'))`,
    })
    .from(clientReconciliationComparison)
    .where(eq(clientReconciliationComparison.sessionId, sessionId));

  const s = stats[0];
  if (s) {
    await database
      .update(clientReconciliationSession)
      .set({
        totalFranchisees: s.total,
        matchedCount: s.matched,
        needsReviewCount: s.needsReview,
        approvedCount: s.approved,
        updatedAt: new Date(),
      })
      .where(eq(clientReconciliationSession.id, sessionId));
  }
}

/**
 * Get approved comparisons for Hashavshevet export
 */
export async function getApprovedComparisonsForExport(
  sessionId: string
): Promise<
  Array<{
    franchiseeName: string;
    franchiseeCode: string;
    clientAmount: string | null;
    commissionAmount: string | null;
    netAmount: string | null;
    actualCommissionRate: string | null;
  }>
> {
  return database
    .select({
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      clientAmount: clientReconciliationComparison.clientAmount,
      commissionAmount: clientReconciliationComparison.commissionAmount,
      netAmount: clientReconciliationComparison.netAmount,
      actualCommissionRate: clientReconciliationComparison.actualCommissionRate,
    })
    .from(clientReconciliationComparison)
    .innerJoin(
      franchisee,
      eq(clientReconciliationComparison.franchiseeId, franchisee.id)
    )
    .where(
      and(
        eq(clientReconciliationComparison.sessionId, sessionId),
        inArray(clientReconciliationComparison.status, [
          "auto_approved",
          "manually_approved",
        ])
      )
    )
    .orderBy(franchisee.name);
}
