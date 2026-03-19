/**
 * Client Reconciliation Session Detail API
 *
 * GET   - Get session with all comparisons
 * PATCH - Approve or reject session
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import {
  getSessionWithComparisons,
  approveSession,
  rejectSession,
} from "@/data-access/client-reconciliation";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const { sessionId } = await params;

  try {
    const result = await getSessionWithComparisons(sessionId);
    if (!result) {
      return NextResponse.json({ error: "התאמה לא נמצאה" }, { status: 404 });
    }
    return NextResponse.json(result);
  } catch (error) {
    console.error("Error fetching session:", error);
    return NextResponse.json({ error: "שגיאה בטעינת התאמה" }, { status: 500 });
  }
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  const { user } = authResult;

  const { sessionId } = await params;

  try {
    const { action, reason } = await request.json();

    if (action === "approve") {
      const session = await approveSession(sessionId, user.id);
      return NextResponse.json(session);
    } else if (action === "reject") {
      if (!reason) {
        return NextResponse.json(
          { error: "נדרשת סיבה לדחייה" },
          { status: 400 }
        );
      }
      const session = await rejectSession(sessionId, reason);
      return NextResponse.json(session);
    }

    return NextResponse.json({ error: "פעולה לא תקינה" }, { status: 400 });
  } catch (error) {
    console.error("Error updating session:", error);
    return NextResponse.json({ error: "שגיאה בעדכון התאמה" }, { status: 500 });
  }
}
