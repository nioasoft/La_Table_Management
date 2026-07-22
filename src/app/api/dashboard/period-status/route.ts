import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { database } from "@/db";
import {
  reconciliationSession,
  reconciliationComparison,
  supplier,
  franchisee,
  fileRequest,
  supplierFileUpload,
} from "@/db/schema";
import { eq, and, gte, lte, sql, or, inArray, isNull } from "drizzle-orm";

/**
 * Response type for period status dashboard widget
 */
export type PeriodStatusResponse = {
  crossReferenceStatus: {
    total: number;
    matched: number;
    discrepancies: number;
    pending: number;
    matchedPercentage: number;
    discrepancyDetails: Array<{
      crossRefId: string;
      supplierName: string;
      franchiseeName: string;
      supplierAmount: number;
      franchiseeAmount: number;
      difference: number;
    }>;
  };
  pendingActions: {
    total: number;
    items: Array<{
      type: "discrepancy" | "approval" | "pending_cross_ref" | "expiring_link";
      count: number;
      priority: "high" | "medium" | "low";
      description: string;
    }>;
  };
  pendingApprovalDetails: Array<{
    sessionId: string;
    supplierId: string;
    supplierName: string;
  }>;
  /** Supplier files in needs_review — awaiting file approval (before a reconciliation session exists) */
  pendingFileReviews: Array<{
    fileId: string;
    supplierId: string;
    supplierName: string;
    fileName: string;
  }>;
};

/**
 * GET /api/dashboard/period-status
 * Returns reconciliation V2 status and pending actions for the dashboard.
 *
 * Optional query params:
 * - periodStart (YYYY-MM-DD): filter sessions whose period overlaps
 * - periodEnd   (YYYY-MM-DD): filter sessions whose period overlaps
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const periodStart = searchParams.get("periodStart");
    const periodEnd = searchParams.get("periodEnd");
    const filterByPeriod = Boolean(periodStart && periodEnd);

    const now = new Date();
    const currentYear = now.getFullYear();
    const currentMonthStart = new Date(currentYear, now.getMonth(), 1);

    // Build V2 session filter conditions
    const sessionConditions = [
      inArray(reconciliationSession.status, ["in_progress", "completed", "file_approved"]),
    ];
    if (filterByPeriod) {
      sessionConditions.push(
        lte(reconciliationSession.periodStartDate, periodEnd!),
        gte(reconciliationSession.periodEndDate, periodStart!),
      );
    }

    // Build filter for completed (pending approval) sessions
    const completedSessionConditions = [
      eq(reconciliationSession.status, "completed"),
    ];
    if (filterByPeriod) {
      completedSessionConditions.push(
        lte(reconciliationSession.periodStartDate, periodEnd!),
        gte(reconciliationSession.periodEndDate, periodStart!),
      );
    }

    // Supplier files still awaiting manual review (file-level approval).
    // NULL-period files are failed auto-parses — attribute them by upload date.
    const pendingFileConditions = [
      eq(supplierFileUpload.processingStatus, "needs_review" as const),
    ];
    if (filterByPeriod) {
      pendingFileConditions.push(
        or(
          and(
            lte(supplierFileUpload.periodStartDate, periodEnd!),
            gte(supplierFileUpload.periodEndDate, periodStart!),
          ),
          and(
            isNull(supplierFileUpload.periodStartDate),
            gte(supplierFileUpload.createdAt, new Date(periodStart!)),
          ),
        )!,
      );
    }

    // Fetch V2 reconciliation stats and file requests in parallel
    const [sessionStats, discrepancyRows, fileRequests, completedSessions, pendingFiles] = await Promise.all([
      // Aggregate counts from reconciliation_session
      database
        .select({
          totalFranchisees: sql<number>`coalesce(sum(${reconciliationSession.totalFranchisees}), 0)::int`,
          needsReviewCount: sql<number>`coalesce(sum(${reconciliationSession.needsReviewCount}), 0)::int`,
          approvedCount: sql<number>`coalesce(sum(${reconciliationSession.approvedCount}), 0)::int`,
          toReviewQueueCount: sql<number>`coalesce(sum(${reconciliationSession.toReviewQueueCount}), 0)::int`,
        })
        .from(reconciliationSession)
        .where(and(...sessionConditions)),

      // Get top 10 needs_review comparisons for discrepancy details
      database
        .select({
          comparisonId: reconciliationComparison.id,
          supplierName: supplier.name,
          franchiseeName: franchisee.name,
          supplierAmount: reconciliationComparison.supplierAmount,
          franchiseeAmount: reconciliationComparison.franchiseeAmount,
          difference: reconciliationComparison.difference,
        })
        .from(reconciliationComparison)
        .innerJoin(
          reconciliationSession,
          eq(reconciliationComparison.sessionId, reconciliationSession.id),
        )
        .innerJoin(supplier, eq(reconciliationSession.supplierId, supplier.id))
        .innerJoin(franchisee, eq(reconciliationComparison.franchiseeId, franchisee.id))
        .where(
          and(
            eq(reconciliationComparison.status, "needs_review"),
            ...sessionConditions,
          ),
        )
        .limit(10),

      // Get recent file requests (for expiring links)
      database
        .select()
        .from(fileRequest)
        .where(
          and(
            or(
              eq(fileRequest.status, "pending"),
              eq(fileRequest.status, "sent"),
              eq(fileRequest.status, "submitted"),
            ),
            gte(fileRequest.createdAt, currentMonthStart),
          ),
        ),

      // Get sessions with status "completed" (pending file approval)
      database
        .select({
          sessionId: reconciliationSession.id,
          supplierId: reconciliationSession.supplierId,
          supplierName: supplier.name,
        })
        .from(reconciliationSession)
        .innerJoin(supplier, eq(reconciliationSession.supplierId, supplier.id))
        .where(and(...completedSessionConditions)),

      // Supplier files awaiting manual review
      database
        .select({
          fileId: supplierFileUpload.id,
          supplierId: supplierFileUpload.supplierId,
          supplierName: supplier.name,
          fileName: supplierFileUpload.originalFileName,
        })
        .from(supplierFileUpload)
        .innerJoin(supplier, eq(supplierFileUpload.supplierId, supplier.id))
        .where(and(...pendingFileConditions)),
    ]);

    // Extract V2 aggregated stats
    const stats = sessionStats[0];
    const totalFranchisees = stats?.totalFranchisees ?? 0;
    const approvedCount = stats?.approvedCount ?? 0;
    const needsReviewCount = stats?.needsReviewCount ?? 0;
    const toReviewQueueCount = stats?.toReviewQueueCount ?? 0;

    // Map V2 stats to existing response structure
    // approvedCount already includes both auto_approved + manually_approved
    const matched = approvedCount;
    // discrepancies = items needing manual review
    const discrepancies = needsReviewCount;
    // pending = escalated items in review queue
    const pending = toReviewQueueCount;
    const total = totalFranchisees;
    const matchedPercentage =
      total > 0 ? Math.round((matched / total) * 100) : 0;

    // Map discrepancy details
    const discrepancyDetails = discrepancyRows.map((row) => ({
      crossRefId: row.comparisonId,
      supplierName: row.supplierName ?? "לא ידוע",
      franchiseeName: row.franchiseeName ?? "לא ידוע",
      supplierAmount: parseFloat(row.supplierAmount || "0"),
      franchiseeAmount: parseFloat(row.franchiseeAmount || "0"),
      difference: parseFloat(row.difference || "0"),
    }));

    const crossReferenceStatus: PeriodStatusResponse["crossReferenceStatus"] = {
      total,
      matched,
      discrepancies,
      pending,
      matchedPercentage,
      discrepancyDetails,
    };

    // Calculate pending actions
    const pendingActionItems: PeriodStatusResponse["pendingActions"]["items"] =
      [];

    // Files/sessions awaiting approval (high priority):
    // reconciliation sessions pending approval + supplier files pending review
    const totalAwaitingApproval = completedSessions.length + pendingFiles.length;
    if (totalAwaitingApproval > 0) {
      pendingActionItems.push({
        type: "approval",
        count: totalAwaitingApproval,
        priority: "high",
        description: `${totalAwaitingApproval} קבצים ממתינים לאישור`,
      });
    }

    // Items in review queue awaiting resolution (medium priority)
    if (toReviewQueueCount > 0) {
      pendingActionItems.push({
        type: "pending_cross_ref",
        count: toReviewQueueCount,
        priority: "medium",
        description: `${toReviewQueueCount} פריטים בתור לבדיקה`,
      });
    }

    // Expiring upload links (low priority)
    const expiringLinks = fileRequests.filter((fr) => {
      if (!fr.dueDate) return false;
      const dueDate = new Date(fr.dueDate);
      const daysUntilDue = Math.ceil(
        (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24),
      );
      return daysUntilDue <= 3 && daysUntilDue > 0;
    }).length;

    if (expiringLinks > 0) {
      pendingActionItems.push({
        type: "expiring_link",
        count: expiringLinks,
        priority: "low",
        description: `${expiringLinks} קישורי העלאה עומדים לפוג`,
      });
    }

    const pendingActions: PeriodStatusResponse["pendingActions"] = {
      total: pendingActionItems.reduce((sum, item) => sum + item.count, 0),
      items: pendingActionItems.sort((a, b) => {
        const priorityOrder = { high: 0, medium: 1, low: 2 };
        return priorityOrder[a.priority] - priorityOrder[b.priority];
      }),
    };

    const pendingApprovalDetails = completedSessions.map((s) => ({
      sessionId: s.sessionId,
      supplierId: s.supplierId,
      supplierName: s.supplierName ?? "לא ידוע",
    }));

    const response: PeriodStatusResponse = {
      crossReferenceStatus,
      pendingActions,
      pendingApprovalDetails,
      pendingFileReviews: pendingFiles,
    };

    return NextResponse.json({ data: response });
  } catch (error) {
    console.error("Error fetching period status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 },
    );
  }
}
