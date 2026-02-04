import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { getSuppliersWithFiles } from "@/data-access/reconciliation-v2";

/**
 * GET /api/reconciliation-v2/suppliers - Get suppliers with uploaded files
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const suppliers = await getSuppliersWithFiles();
    return NextResponse.json(suppliers);
  } catch (error) {
    console.error("Error fetching suppliers with files:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת ספקים" },
      { status: 500 }
    );
  }
}
