import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { refreshFranchiseeAmount } from "@/data-access/reconciliation-v2";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * POST /api/reconciliation-v2/comparisons/[id]/refresh
 *
 * Re-pull this row's franchisee amount from the latest BKMV data while
 * leaving the supplier amount, notes, and any manual status untouched.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { id: comparisonId } = await params;
    if (!comparisonId) {
      return NextResponse.json({ error: "מזהה השוואה חסר" }, { status: 400 });
    }

    const updated = await refreshFranchiseeAmount(comparisonId);
    if (!updated) {
      return NextResponse.json(
        { error: "השוואה לא נמצאה או שהסשן מאורכב" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true, comparison: updated });
  } catch (error) {
    console.error("Error refreshing franchisee amount:", error);
    return NextResponse.json(
      { error: "שגיאה ברענון נתוני הזכיין" },
      { status: 500 }
    );
  }
}
