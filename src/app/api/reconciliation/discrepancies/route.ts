import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import { getDiscrepancies } from "@/data-access/crossReferences";

/**
 * GET /api/reconciliation/discrepancies - Get all discrepancies that need review
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user has permission
    const userRole = (session.user as typeof session.user & { role?: string }).role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const discrepancies = await getDiscrepancies();

    return NextResponse.json({
      discrepancies,
      total: discrepancies.length,
    });
  } catch (error) {
    console.error("Error fetching discrepancies:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
