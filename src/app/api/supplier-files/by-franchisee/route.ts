import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getFranchiseeBreakdownReport } from "@/data-access/supplier-file-reports";

/**
 * GET /api/supplier-files/by-franchisee - Get supplier file data grouped by franchisee
 *
 * Query params:
 * - startDate: string (YYYY-MM-DD) - filter by period start
 * - endDate: string (YYYY-MM-DD) - filter by period end
 * - brandId: string - filter by brand
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const startDate = searchParams.get("startDate") || undefined;
    const endDate = searchParams.get("endDate") || undefined;
    const brandId = searchParams.get("brandId") || undefined;

    const report = await getFranchiseeBreakdownReport({
      startDate,
      endDate,
      brandId,
    });

    return NextResponse.json(report);
  } catch (error) {
    console.error("Error fetching franchisee breakdown:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
