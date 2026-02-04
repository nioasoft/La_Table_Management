import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { bulkApproveComparisons } from "@/data-access/reconciliation-v2";

/**
 * POST /api/reconciliation-v2/comparisons/bulk-approve - Bulk approve comparisons
 * Body:
 *   comparisonIds: string[]
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const { comparisonIds } = body;

    if (!comparisonIds || !Array.isArray(comparisonIds) || comparisonIds.length === 0) {
      return NextResponse.json(
        { error: "רשימת מזהי השוואות חסרה או ריקה" },
        { status: 400 }
      );
    }

    const approvedCount = await bulkApproveComparisons(comparisonIds, user.id);

    return NextResponse.json({
      success: true,
      approvedCount,
    });
  } catch (error) {
    console.error("Error bulk approving comparisons:", error);
    return NextResponse.json(
      { error: "שגיאה באישור מרובה" },
      { status: 500 }
    );
  }
}
