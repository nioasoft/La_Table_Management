import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getReconciliationStats, getDiscrepancies } from "@/data-access/crossReferences";
import { getPendingApprovalSettlements } from "@/data-access/settlements";

/**
 * Dashboard statistics response type
 */
export type DashboardStatsResponse = {
  pendingCrossReferences: number;
  discrepanciesRequiringAttention: number;
  itemsAwaitingApproval: number;
};

/**
 * GET /api/dashboard/stats - Get dashboard widget statistics
 * Returns counts for:
 * - Pending cross-references
 * - Discrepancies requiring attention
 * - Items awaiting approval (settlements)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Fetch all statistics in parallel for better performance
    const [reconciliationStats, discrepancies, pendingApprovalSettlements] = await Promise.all([
      getReconciliationStats(),
      getDiscrepancies(),
      getPendingApprovalSettlements(),
    ]);

    const stats: DashboardStatsResponse = {
      pendingCrossReferences: reconciliationStats.pending,
      discrepanciesRequiringAttention: discrepancies.length,
      itemsAwaitingApproval: pendingApprovalSettlements.length,
    };

    return NextResponse.json({ stats });
  } catch (error) {
    console.error("Error fetching dashboard stats:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
