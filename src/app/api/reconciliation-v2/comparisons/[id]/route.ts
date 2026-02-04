import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import {
  updateComparisonStatus,
  addToReviewQueue,
} from "@/data-access/reconciliation-v2";
import type { ReconciliationComparisonStatus } from "@/db/schema";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * PATCH /api/reconciliation-v2/comparisons/[id] - Update comparison status
 * Body:
 *   status: ReconciliationComparisonStatus
 *   notes?: string
 *   sessionId?: string (required for sent_to_review_queue)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { id: comparisonId } = await params;
    const body = await request.json();
    const { status, notes, sessionId } = body;

    if (!comparisonId) {
      return NextResponse.json(
        { error: "מזהה השוואה חסר" },
        { status: 400 }
      );
    }

    if (!status) {
      return NextResponse.json(
        { error: "סטטוס חסר" },
        { status: 400 }
      );
    }

    const validStatuses: ReconciliationComparisonStatus[] = [
      "pending",
      "auto_approved",
      "needs_review",
      "manually_approved",
      "sent_to_review_queue",
    ];

    if (!validStatuses.includes(status)) {
      return NextResponse.json(
        { error: "סטטוס לא חוקי" },
        { status: 400 }
      );
    }

    // Special handling for adding to review queue
    if (status === "sent_to_review_queue") {
      if (!sessionId) {
        return NextResponse.json(
          { error: "מזהה סשן חסר להוספה לתור בדיקה" },
          { status: 400 }
        );
      }

      const queueItem = await addToReviewQueue(comparisonId, sessionId);
      if (!queueItem) {
        return NextResponse.json(
          { error: "שגיאה בהוספה לתור בדיקה" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        queueItem,
      });
    }

    // Regular status update
    const result = await updateComparisonStatus(
      comparisonId,
      status,
      user.id,
      notes
    );

    if (!result) {
      return NextResponse.json(
        { error: "שגיאה בעדכון סטטוס" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      comparison: result,
    });
  } catch (error) {
    console.error("Error updating comparison:", error);
    return NextResponse.json(
      { error: "שגיאה בעדכון השוואה" },
      { status: 500 }
    );
  }
}
