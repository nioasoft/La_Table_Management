import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getAllFranchiseeReminderCounts } from "@/data-access/franchiseeImportantDates";

/**
 * GET /api/franchisees/important-dates/reminder-counts - Get reminder counts for all franchisees
 * Returns a map of franchiseeId -> active reminder count
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const countsMap = await getAllFranchiseeReminderCounts();

    // Convert Map to plain object for JSON serialization
    const counts: Record<string, number> = {};
    for (const [franchiseeId, count] of countsMap) {
      counts[franchiseeId] = count;
    }

    return NextResponse.json({ counts });
  } catch (error) {
    console.error("Error fetching reminder counts:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
