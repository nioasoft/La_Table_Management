import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { database } from "@/db";
import {
  crossReference,
  fileRequest,
  supplierFileUpload,
} from "@/db/schema";
import { eq, and, gte, sql, or } from "drizzle-orm";
import type { CrossReferenceComparisonMetadata } from "@/data-access/crossReferences";

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
      type: "discrepancy" | "approval" | "expiring_link";
      count: number;
      priority: "high" | "medium" | "low";
      description: string;
    }>;
  };
};

/**
 * Check whether two date ranges overlap.
 * Ranges are inclusive: [startA, endA] overlaps [startB, endB]
 * iff startA <= endB AND endA >= startB.
 */
function periodsOverlap(
  startA: string,
  endA: string,
  startB: string,
  endB: string
): boolean {
  return startA <= endB && endA >= startB;
}

/**
 * GET /api/dashboard/period-status
 * Returns cross-reference status and pending actions for the dashboard.
 *
 * Optional query params:
 * - periodStart (YYYY-MM-DD): filter cross-references whose period overlaps
 * - periodEnd   (YYYY-MM-DD): filter cross-references whose period overlaps
 *
 * When both are provided, only cross-references with metadata period dates
 * overlapping the given range are included. Otherwise, ALL active cross-references
 * are returned (backward compatible).
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

    // Fetch all data in parallel
    const [crossReferences, fileRequests, needsReviewCount] = await Promise.all([
      // Get ALL active cross-references
      database
        .select()
        .from(crossReference)
        .where(
          and(
            eq(crossReference.referenceType, "amount_comparison"),
            eq(crossReference.isActive, true)
          )
        ),

      // Get recent file requests
      database
        .select()
        .from(fileRequest)
        .where(
          and(
            or(
              eq(fileRequest.status, "pending"),
              eq(fileRequest.status, "sent"),
              eq(fileRequest.status, "submitted")
            ),
            gte(fileRequest.createdAt, currentMonthStart)
          )
        ),

      // Count supplier files pending review
      database
        .select({ count: sql<number>`count(*)::int` })
        .from(supplierFileUpload)
        .where(eq(supplierFileUpload.processingStatus, "needs_review")),
    ]);

    // Filter cross-references by period if requested
    const filteredCrossRefs = filterByPeriod
      ? crossReferences.filter((cr) => {
          const metadata = cr.metadata as CrossReferenceComparisonMetadata;
          const crStart = metadata?.periodStartDate;
          const crEnd = metadata?.periodEndDate;
          if (!crStart || !crEnd) return false;
          return periodsOverlap(crStart, crEnd, periodStart!, periodEnd!);
        })
      : crossReferences;

    // Process cross-reference status
    let matched = 0;
    let discrepancies = 0;
    let pending = 0;

    for (const cr of filteredCrossRefs) {
      const metadata = cr.metadata as CrossReferenceComparisonMetadata;
      const status = metadata?.matchStatus || "pending";
      if (status === "matched") {
        matched++;
      } else if (status === "discrepancy") {
        discrepancies++;
      } else {
        pending++;
      }
    }

    const totalCrossRefs = filteredCrossRefs.length;
    const matchedPercentage =
      totalCrossRefs > 0 ? Math.round((matched / totalCrossRefs) * 100) : 0;

    // Extract top 10 discrepancy details
    const discrepancyDetails = filteredCrossRefs
      .filter((cr) => {
        const metadata = cr.metadata as CrossReferenceComparisonMetadata;
        return metadata?.matchStatus === "discrepancy";
      })
      .slice(0, 10)
      .map((cr) => {
        const metadata = cr.metadata as CrossReferenceComparisonMetadata;
        return {
          crossRefId: cr.id,
          supplierName: metadata?.supplierName || "לא ידוע",
          franchiseeName: metadata?.franchiseeName || "לא ידוע",
          supplierAmount: parseFloat(metadata?.supplierAmount || "0"),
          franchiseeAmount: parseFloat(metadata?.franchiseeAmount || "0"),
          difference: parseFloat(metadata?.difference || "0"),
        };
      });

    const crossReferenceStatus: PeriodStatusResponse["crossReferenceStatus"] = {
      total: totalCrossRefs,
      matched,
      discrepancies,
      pending,
      matchedPercentage,
      discrepancyDetails,
    };

    // Calculate pending actions
    const pendingActionItems: PeriodStatusResponse["pendingActions"]["items"] =
      [];

    // Discrepancies (high priority)
    if (discrepancies > 0) {
      pendingActionItems.push({
        type: "discrepancy",
        count: discrepancies,
        priority: "high",
        description: `${discrepancies} פערים דורשים בדיקה`,
      });
    }

    // Files pending review (high priority)
    const pendingReview = needsReviewCount[0]?.count || 0;
    if (pendingReview > 0) {
      pendingActionItems.push({
        type: "approval",
        count: pendingReview,
        priority: "high",
        description: `${pendingReview} קבצים ממתינים לבדיקה`,
      });
    }

    // Expiring upload links (low priority)
    const expiringLinks = fileRequests.filter((fr) => {
      if (!fr.dueDate) return false;
      const dueDate = new Date(fr.dueDate);
      const daysUntilDue = Math.ceil(
        (dueDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)
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

    const response: PeriodStatusResponse = {
      crossReferenceStatus,
      pendingActions,
    };

    return NextResponse.json({ data: response });
  } catch (error) {
    console.error("Error fetching period status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
