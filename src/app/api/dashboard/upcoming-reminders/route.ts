import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
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
