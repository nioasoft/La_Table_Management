import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { rebuildReconciliationSession } from "@/data-access/reconciliation-v2";

interface RouteParams {
  params: Promise<{ sessionId: string }>;
}

/**
 * POST /api/reconciliation-v2/sessions/[sessionId]/rebuild
 *
 * Rebuilds the session from CURRENT data: picks up the latest supplier file(s)
 * and the latest BKMV year amounts, archives the stale source, and creates a
 * fresh run (runNumber+1). Use after a newer supplier file or BKMV upload made
 * the session's stored amounts out of date (the `stale_at` case).
 *
 * Response: the new session.
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

    const newSession = await rebuildReconciliationSession(sessionId, user.id);
    if (!newSession) {
      return NextResponse.json(
        { error: "שגיאה בבניית הסשן מחדש" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true, session: newSession });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    console.error("[rebuild] failed:", message);

    if (message.includes("not found")) {
      return NextResponse.json({ error: "הסשן לא נמצא" }, { status: 404 });
    }
    if (message.includes("archived")) {
      return NextResponse.json(
        { error: "לא ניתן לבנות מחדש סשן מאורכב" },
        { status: 409 }
      );
    }
    if (message.includes("No supplier file")) {
      return NextResponse.json(
        { error: "אין קובץ ספק זמין לבניית הסשן מחדש" },
        { status: 409 }
      );
    }

    return NextResponse.json(
      { error: "שגיאה בבניית הסשן מחדש" },
      { status: 500 }
    );
  }
}
