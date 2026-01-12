import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getUpcomingRemindersForDashboard,
  getFranchiseeReminderStats,
  type FranchiseeReminderWithFranchisee,
} from "@/data-access/franchiseeReminders";
import type { FranchiseeReminderType } from "@/db/schema";

/**
 * Upcoming reminders response type for dashboard widget
 */
export type UpcomingRemindersResponse = {
  reminders: FranchiseeReminderWithFranchisee[];
  stats: {
    total: number;
    pending: number;
    byType: { type: FranchiseeReminderType; count: number }[];
    upcomingThisWeek: number;
    upcomingThisMonth: number;
  };
};

/**
 * GET /api/dashboard/upcoming-reminders - Get upcoming reminders for dashboard widget
 * Query params:
 * - daysAhead: Number of days to look ahead (default: 30)
 * - limit: Maximum number of reminders to return (default: 10)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;
    const daysAhead = parseInt(searchParams.get("daysAhead") || "30", 10);
    const limit = parseInt(searchParams.get("limit") || "10", 10);

    // Fetch reminders and stats in parallel
    const [reminders, fullStats] = await Promise.all([
      getUpcomingRemindersForDashboard(daysAhead, limit),
      getFranchiseeReminderStats(),
    ]);

    const response: UpcomingRemindersResponse = {
      reminders,
      stats: {
        total: fullStats.total,
        pending: fullStats.pending,
        byType: fullStats.byType,
        upcomingThisWeek: fullStats.upcomingThisWeek,
        upcomingThisMonth: fullStats.upcomingThisMonth,
      },
    };

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching upcoming reminders:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
