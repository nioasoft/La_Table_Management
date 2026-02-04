import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { getReconciliationHistory } from "@/data-access/reconciliation-v2";

/**
 * GET /api/reconciliation-v2/history - Get reconciliation history with filters
 * Query params:
 *   supplierId?: string
 *   franchiseeId?: string
 *   periodStartDate?: string
 *   periodEndDate?: string
 *   limit?: number
 *   offset?: number
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);

    const filters = {
      supplierId: searchParams.get("supplierId") || undefined,
      franchiseeId: searchParams.get("franchiseeId") || undefined,
      periodStartDate: searchParams.get("periodStartDate") || undefined,
      periodEndDate: searchParams.get("periodEndDate") || undefined,
      limit: searchParams.get("limit")
        ? parseInt(searchParams.get("limit")!)
        : undefined,
      offset: searchParams.get("offset")
        ? parseInt(searchParams.get("offset")!)
        : undefined,
    };

    const result = await getReconciliationHistory(filters);
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching reconciliation history:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת היסטוריה" },
      { status: 500 }
    );
  }
}
