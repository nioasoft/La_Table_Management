import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getFranchiseeById,
  getFranchiseeStatusHistory,
} from "@/data-access/franchisees";

interface RouteContext {
  params: Promise<{ franchiseeId: string }>;
}

/**
 * GET /api/franchisees/[franchiseeId]/status-history - Get status change history
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;

    // Only admins and super users can view status history
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { franchiseeId } = await context.params;

    // Check if franchisee exists
    const franchisee = await getFranchiseeById(franchiseeId);
    if (!franchisee) {
      return NextResponse.json(
        { error: "Franchisee not found" },
        { status: 404 }
      );
    }

    // Fetch status history
    const history = await getFranchiseeStatusHistory(franchiseeId);

    return NextResponse.json({
      franchiseeId,
      franchiseeName: franchisee.name,
      currentStatus: franchisee.status,
      history,
    });
  } catch (error) {
    console.error("Error fetching status history:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
