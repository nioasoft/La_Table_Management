import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { cloneSessionAndMatchAll } from "@/data-access/reconciliation-v2";

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

/**
 * POST /api/reconciliation-v2/sessions/[sessionId]/match-all
 *
 * Clones the active session into a new run and auto-approves every comparison
 * with absoluteDifference ≤ ₪30 currently in `needs_review`. The source session
 * is archived to preserve history.
 *
 * Response: { success, newSessionId, matchedCount, belowThresholdCount }
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { sessionId } = await params;
    if (!sessionId) {
      return NextResponse.json({ error: "מזהה סשן חסר" }, { status: 400 });
    }

    const result = await cloneSessionAndMatchAll(sessionId, user.id);

    return NextResponse.json({ success: true, ...result });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[match-all] failed:", message);

    if (message.includes("not found")) {
      return NextResponse.json({ error: "הסשן לא נמצא" }, { status: 404 });
    }
    if (message.includes("archived")) {
      return NextResponse.json(
        { error: "לא ניתן להפעיל התאם הכל על סשן מאורכב" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "שגיאה בביצוע התאם הכל" },
      { status: 500 }
    );
  }
}
