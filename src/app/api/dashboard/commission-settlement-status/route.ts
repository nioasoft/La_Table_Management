import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { database } from "@/db";
import { settlementPeriod, commission } from "@/db/schema";
import { eq, and, gte, lte, sql, desc } from "drizzle-orm";
import { formatDateAsLocal } from "@/lib/date-utils";

/**
 * Response type for commission and settlement status widget
 */
export type CommissionSettlementStatusResponse = {
  currentPeriod: {
    name: string;
    startDate: string;
    endDate: string;
    status: string;
    daysRemaining: number;
  } | null;
  commissionSummary: {
    totalAmount: number;
    pendingCount: number;
    approvedCount: number;
    paidCount: number;
  };
  settlementWorkflow: {
    open: number;
    processing: number;
    pendingApproval: number;
    approved: number;
    invoiced: number;
  };
};

/**
 * GET /api/dashboard/commission-settlement-status
 * Returns:
 * - Current period status
 * - Total commissions this period
 * - Settlement workflow progress
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Calculate current period dates (current month)
    const now = new Date();
    const currentMonthStart = new Date(now.getFullYear(), now.getMonth(), 1);
    const currentMonthEnd = new Date(now.getFullYear(), now.getMonth() + 1, 0);
    const currentMonthStartStr = formatDateAsLocal(currentMonthStart);
    const currentMonthEndStr = formatDateAsLocal(currentMonthEnd);

    // Fetch all data in parallel
    const [
      currentPeriodResult,
      commissionStats,
      settlementStats,
    ] = await Promise.all([
      // Get current/most recent open settlement period
      database
        .select()
        .from(settlementPeriod)
        .where(eq(settlementPeriod.status, "open"))
        .orderBy(desc(settlementPeriod.periodStartDate))
        .limit(1),

      // Get commission stats for current period
      database
        .select({
          status: commission.status,
          count: sql<number>`count(*)::int`,
          totalAmount: sql<number>`coalesce(sum(${commission.commissionAmount}::numeric), 0)::numeric`,
        })
        .from(commission)
        .where(
          and(
            gte(commission.periodStartDate, currentMonthStartStr),
            lte(commission.periodEndDate, currentMonthEndStr)
          )
        )
        .groupBy(commission.status),

      // Get settlement workflow counts by status
      database
        .select({
          status: settlementPeriod.status,
          count: sql<number>`count(*)::int`,
        })
        .from(settlementPeriod)
        .groupBy(settlementPeriod.status),
    ]);

    // Process current period
    let currentPeriod: CommissionSettlementStatusResponse["currentPeriod"] = null;
    if (currentPeriodResult.length > 0) {
      const period = currentPeriodResult[0];
      const endDate = new Date(period.periodEndDate);
      const daysRemaining = Math.max(0, Math.ceil((endDate.getTime() - now.getTime()) / (1000 * 60 * 60 * 24)));

      currentPeriod = {
        name: period.name,
        startDate: period.periodStartDate,
        endDate: period.periodEndDate,
        status: period.status,
        daysRemaining,
      };
    }

    // Process commission summary
    const commissionSummary = {
      totalAmount: 0,
      pendingCount: 0,
      approvedCount: 0,
      paidCount: 0,
    };

    for (const stat of commissionStats) {
      commissionSummary.totalAmount += Number(stat.totalAmount);
      switch (stat.status) {
        case "pending":
        case "calculated":
          commissionSummary.pendingCount += stat.count;
          break;
        case "approved":
          commissionSummary.approvedCount += stat.count;
          break;
        case "paid":
          commissionSummary.paidCount += stat.count;
          break;
      }
    }

    // Process settlement workflow
    const settlementWorkflow = {
      open: 0,
      processing: 0,
      pendingApproval: 0,
      approved: 0,
      invoiced: 0,
    };

    for (const stat of settlementStats) {
      switch (stat.status) {
        case "open":
        case "draft":
          settlementWorkflow.open += stat.count;
          break;
        case "processing":
        case "pending":
          settlementWorkflow.processing += stat.count;
          break;
        case "pending_approval":
          settlementWorkflow.pendingApproval += stat.count;
          break;
        case "approved":
          settlementWorkflow.approved += stat.count;
          break;
        case "invoiced":
        case "completed":
          settlementWorkflow.invoiced += stat.count;
          break;
      }
    }

    const response: CommissionSettlementStatusResponse = {
      currentPeriod,
      commissionSummary,
      settlementWorkflow,
    };

    return NextResponse.json({ data: response });
  } catch (error) {
    console.error("Error fetching commission settlement status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
