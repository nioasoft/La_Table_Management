import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
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
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

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
