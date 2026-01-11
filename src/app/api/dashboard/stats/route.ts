import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
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
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user has permission (admin or super_user)
    const userRole = (session.user as typeof session.user & { role?: string }).role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
