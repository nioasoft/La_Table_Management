import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import {
  getSessionById,
  getSessionWithComparisons,
  approveSessionFile,
  rejectSessionFile,
  deleteSession,
} from "@/data-access/reconciliation-v2";

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

/**
 * GET /api/reconciliation-v2/sessions/[sessionId] - Get session details
 * Query params:
 *   include=comparisons - Include comparisons in response
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { sessionId } = await params;
    const { searchParams } = new URL(request.url);
    const include = searchParams.get("include");

    if (!sessionId) {
      return NextResponse.json(
        { error: "מזהה סשן חסר" },
        { status: 400 }
      );
    }

    if (include === "comparisons") {
      const result = await getSessionWithComparisons(sessionId);
      if (!result) {
        return NextResponse.json(
          { error: "סשן לא נמצא" },
          { status: 404 }
        );
      }
      return NextResponse.json(result);
    }

    const session = await getSessionById(sessionId);
    if (!session) {
      return NextResponse.json(
        { error: "סשן לא נמצא" },
        { status: 404 }
      );
    }

    return NextResponse.json(session);
  } catch (error) {
    console.error("Error fetching session:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת סשן" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/reconciliation-v2/sessions/[sessionId] - Update session status
 * Body:
 *   action: "approve" | "reject"
 *   reason?: string (required for reject)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { sessionId } = await params;
    const body = await request.json();
    const { action, reason } = body;

    if (!sessionId) {
      return NextResponse.json(
        { error: "מזהה סשן חסר" },
        { status: 400 }
      );
    }

    if (!action || !["approve", "reject"].includes(action)) {
      return NextResponse.json(
        { error: "פעולה לא חוקית" },
        { status: 400 }
      );
    }

    if (action === "reject" && !reason) {
      return NextResponse.json(
        { error: "סיבת דחייה חסרה" },
        { status: 400 }
      );
    }

    let result;
    if (action === "approve") {
      result = await approveSessionFile(sessionId, user.id);
    } else {
      result = await rejectSessionFile(sessionId, user.id, reason);
    }

    if (!result) {
      return NextResponse.json(
        { error: "שגיאה בעדכון סשן" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      session: result,
    });
  } catch (error) {
    console.error("Error updating session:", error);
    return NextResponse.json(
      { error: "שגיאה בעדכון סשן" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/reconciliation-v2/sessions/[sessionId] - Delete a session
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { sessionId } = await params;

    if (!sessionId) {
      return NextResponse.json(
        { error: "מזהה סשן חסר" },
        { status: 400 }
      );
    }

    const deleted = await deleteSession(sessionId);

    if (!deleted) {
      return NextResponse.json(
        { error: "סשן לא נמצא או לא ניתן למחיקה" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "הסשן נמחק בהצלחה",
    });
  } catch (error) {
    console.error("Error deleting session:", error);
    return NextResponse.json(
      { error: "שגיאה במחיקת סשן" },
      { status: 500 }
    );
  }
}
