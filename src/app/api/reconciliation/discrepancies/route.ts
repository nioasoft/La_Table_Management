import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getDiscrepancies } from "@/data-access/crossReferences";

/**
 * GET /api/reconciliation/discrepancies - Get all discrepancies that need review
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

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
