import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { getReviewQueueItems } from "@/data-access/reconciliation-v2";

/**
 * GET /api/reconciliation-v2/review-queue - Get pending review queue items
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const items = await getReviewQueueItems();
    return NextResponse.json(items);
  } catch (error) {
    console.error("Error fetching review queue:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת תור בדיקה" },
      { status: 500 }
    );
  }
}
