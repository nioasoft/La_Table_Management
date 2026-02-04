import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { getSupplierPeriods } from "@/data-access/reconciliation-v2";

interface RouteParams {
  params: Promise<{ supplierId: string }>;
}

/**
 * GET /api/reconciliation-v2/suppliers/[supplierId]/periods - Get available periods for a supplier
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { supplierId } = await params;

    if (!supplierId) {
      return NextResponse.json(
        { error: "מזהה ספק חסר" },
        { status: 400 }
      );
    }

    const periods = await getSupplierPeriods(supplierId);
    return NextResponse.json(periods);
  } catch (error) {
    console.error("Error fetching supplier periods:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת תקופות" },
      { status: 500 }
    );
  }
}
