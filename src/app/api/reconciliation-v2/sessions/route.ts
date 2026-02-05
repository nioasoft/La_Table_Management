import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { createReconciliationSession, getAllSessions } from "@/data-access/reconciliation-v2";
import { getDatabaseError, isUniqueViolation, isConnectionError } from "@/lib/drizzle-errors";

/**
 * GET /api/reconciliation-v2/sessions - List all reconciliation sessions
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const status = searchParams.get("status") || undefined;
    const supplierId = searchParams.get("supplierId") || undefined;
    const limit = searchParams.get("limit") ? parseInt(searchParams.get("limit")!, 10) : undefined;

    const sessions = await getAllSessions({ status, supplierId, limit });

    return NextResponse.json(sessions);
  } catch (error) {
    console.error("Error fetching sessions:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת סשנים" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/reconciliation-v2/sessions - Create a new reconciliation session
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const { supplierId, supplierFileId, periodStartDate, periodEndDate } = body;

    // Validate required fields
    if (!supplierId) {
      return NextResponse.json(
        { error: "מזהה ספק חסר" },
        { status: 400 }
      );
    }

    if (!supplierFileId) {
      return NextResponse.json(
        { error: "מזהה קובץ ספק חסר" },
        { status: 400 }
      );
    }

    if (!periodStartDate || !periodEndDate) {
      return NextResponse.json(
        { error: "תאריכי תקופה חסרים" },
        { status: 400 }
      );
    }

    const session = await createReconciliationSession(
      supplierId,
      supplierFileId,
      periodStartDate,
      periodEndDate,
      user.id
    );

    if (!session) {
      return NextResponse.json(
        { error: "שגיאה ביצירת סשן התאמה" },
        { status: 500 }
      );
    }

    return NextResponse.json(session);
  } catch (error) {
    const dbError = getDatabaseError(error);
    console.error("Error creating reconciliation session:", {
      message: dbError.message,
      code: dbError.code,
      constraint: dbError.constraint,
      detail: dbError.detail,
      table: dbError.table,
    });

    // Check for unique constraint violation (PG code 23505)
    if (isUniqueViolation(error)) {
      const isSessionUnique = dbError.constraint?.includes("reconciliation_session") ||
        dbError.table === "reconciliation_session";
      return NextResponse.json(
        {
          error: isSessionUnique
            ? "קיים כבר סשן התאמה לתקופה זו"
            : "נמצאו שתי רשומות זהות של זכיין בקובץ הספק. נא לבדוק את התאמות השמות.",
        },
        { status: 409 }
      );
    }

    // Check for connection errors (Neon idle timeout, etc.)
    if (isConnectionError(error)) {
      return NextResponse.json(
        { error: "שגיאת חיבור למסד הנתונים. נא לנסות שוב." },
        { status: 503 }
      );
    }

    return NextResponse.json(
      { error: "שגיאה ביצירת סשן התאמה" },
      { status: 500 }
    );
  }
}
