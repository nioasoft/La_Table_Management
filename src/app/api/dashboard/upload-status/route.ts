import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getFranchiseeBkmvStatusForPeriod } from "@/data-access/uploadLinks";

/**
 * Franchisee BKMV upload status for dashboard
 */
export interface FranchiseeBkmvStatus {
  franchisees: Array<{ id: string; name: string; hasFile: boolean }>;
}

/**
 * GET /api/dashboard/upload-status - Get franchisee BKMV file status for a period
 * Query params:
 *   - periodStart: YYYY-MM-DD (required)
 *   - periodEnd: YYYY-MM-DD (required)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const periodStart = searchParams.get("periodStart");
    const periodEnd = searchParams.get("periodEnd");

    if (!periodStart || !periodEnd) {
      return NextResponse.json(
        { error: "periodStart and periodEnd are required" },
        { status: 400 }
      );
    }

    const result = await getFranchiseeBkmvStatusForPeriod(periodStart, periodEnd);

    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching upload status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
