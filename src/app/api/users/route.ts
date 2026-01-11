import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import { getUsers, getPendingUsers, getUserStats } from "@/data-access/users";

/**
 * GET /api/users - Get all users (Super User/Admin only)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin or super_user
    const userRole = (session.user as typeof session.user & { role?: string })
      .role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
