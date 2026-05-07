import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { database } from "@/db";
import { reconciliationSession } from "@/db/schema";
import { eq } from "drizzle-orm";
import { reprocessSupplierFileById } from "@/data-access/supplier-file-reprocess";

/**
 * POST /api/reconciliation-v2/sessions/[sessionId]/back-to-processing
 *
 * Archives the active reconciliation session and re-runs the parser +
 * franchisee matcher on the underlying supplier file. Manual franchisee
 * match overrides and previously acknowledged anomalies are preserved.
 *
 * Admin/Super User only.
 *
 * Response:
 *   200 { success: true, supplierFileId, before, after }
 *   400 { error } — terminal/archived/missing-file session
 *   404 { error } — session not found
 *   500 { error } — reprocess failed (session was already archived; admin
 *                   can re-upload or use the bulk reprocess endpoint)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ sessionId: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { sessionId } = await params;

    const [session] = await database
      .select({
        id: reconciliationSession.id,
        supplierFileId: reconciliationSession.supplierFileId,
        status: reconciliationSession.status,
        archivedAt: reconciliationSession.archivedAt,
      })
      .from(reconciliationSession)
      .where(eq(reconciliationSession.id, sessionId))
      .limit(1);

    if (!session) {
      return NextResponse.json(
        { error: "ההשוואה לא נמצאה" },
        { status: 404 }
      );
    }

    if (session.archivedAt) {
      return NextResponse.json(
        { error: "ההשוואה כבר מאורכבת" },
        { status: 400 }
      );
    }

    if (
      session.status === "file_approved" ||
      session.status === "file_rejected"
    ) {
      return NextResponse.json(
        { error: "לא ניתן להחזיר לעיבוד השוואה שאושרה או נדחתה" },
        { status: 400 }
      );
    }

    if (!session.supplierFileId) {
      return NextResponse.json(
        { error: "אין קובץ ספק משויך להשוואה זו" },
        { status: 400 }
      );
    }

    // Archive the current session before reprocessing so it stops appearing
    // as the active period session. Same pattern as Match-All
    // (see cloneSessionAndMatchAll in reconciliation-v2.ts).
    const now = new Date();
    await database
      .update(reconciliationSession)
      .set({ archivedAt: now, updatedAt: now })
      .where(eq(reconciliationSession.id, sessionId));

    const outcome = await reprocessSupplierFileById(session.supplierFileId);

    if (!outcome.success) {
      // Session is already archived — surface the error so the admin can
      // recover via the file-list reprocess UI or by re-uploading.
      return NextResponse.json(
        {
          error: `העיבוד נכשל: ${outcome.error}. ההשוואה אורכבה — ניתן לבצע ניסיון נוסף ממסך הקבצים.`,
          supplierFileId: session.supplierFileId,
        },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      supplierFileId: outcome.fileId,
      before: outcome.before,
      after: outcome.after,
    });
  } catch (error) {
    console.error("Error in back-to-processing:", error);
    return NextResponse.json(
      { error: "שגיאת שרת פנימית" },
      { status: 500 }
    );
  }
}
