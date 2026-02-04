import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { getReviewQueueCount } from "@/data-access/reconciliation-v2";

/**
 * GET /api/reconciliation-v2/review-queue/count - Get review queue count for badge
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const count = await getReviewQueueCount();
    return NextResponse.json({ count });
  } catch (error) {
    console.error("Error fetching review queue count:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת מספר פריטים" },
      { status: 500 }
    );
  }
}
