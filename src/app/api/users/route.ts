import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getUsers, getPendingUsers, getUserStats } from "@/data-access/users";

/**
 * GET /api/users - Get all users (Super User/Admin only)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;
    const filter = searchParams.get("filter");

    let users;
    if (filter === "pending") {
      users = await getPendingUsers();
    } else {
      users = await getUsers();
    }

    // Get stats if requested
    const includeStats = searchParams.get("stats") === "true";
    const stats = includeStats ? await getUserStats() : null;

    return NextResponse.json({ users, stats });
  } catch (error) {
    console.error("Error fetching users:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
