import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { resolveReviewQueueItem } from "@/data-access/reconciliation-v2";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/reconciliation-v2/review-queue/[id] - Resolve a review queue item
 * Body:
 *   notes?: string
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { id: queueItemId } = await params;
    const body = await request.json();
    const { notes } = body;

    if (!queueItemId) {
      return NextResponse.json(
        { error: "מזהה פריט חסר" },
        { status: 400 }
      );
    }

    const result = await resolveReviewQueueItem(queueItemId, user.id, notes);

    if (!result) {
      return NextResponse.json(
        { error: "פריט לא נמצא" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      queueItem: result,
    });
  } catch (error) {
    console.error("Error resolving queue item:", error);
    return NextResponse.json(
      { error: "שגיאה בפתרון פריט" },
      { status: 500 }
    );
  }
}
