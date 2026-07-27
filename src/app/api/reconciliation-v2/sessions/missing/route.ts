import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { getPeriodsWithoutSession } from "@/data-access/reconciliation-v2";

/**
 * GET /api/reconciliation-v2/sessions/missing - (supplier × period) pairs that
 * have a supplier file but no active reconciliation session.
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const rows = await getPeriodsWithoutSession();

    return NextResponse.json(rows);
  } catch (error) {
    console.error("Error fetching periods without session:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת תקופות ללא סשן" },
      { status: 500 }
    );
  }
}
