import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { reprocessBkmvFileById } from "@/data-access/bkmv-reprocess";
import {
  getUploadedFileById,
  updateUploadedFileProcessingStatus,
} from "@/data-access/uploadLinks";
import { logAuditEvent, createAuditContext } from "@/data-access/auditLog";

/**
 * POST /api/bkmvdata/review/[fileId]/reprocess
 *
 * Re-runs the BKMV parser + supplier matcher for a single uploaded file
 * (preserving manual supplier overrides + confirmed revenue codes), then
 * resets the file's processingStatus back to `needs_review` so an admin
 * must re-approve. Use when an admin spots a problem with an already-
 * approved file and wants to re-process without re-uploading.
 *
 * Admin/Super User only.
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { fileId } = await params;

    const file = await getUploadedFileById(fileId);
    if (!file) {
      return NextResponse.json(
        { error: "הקובץ לא נמצא" },
        { status: 404 }
      );
    }

    if (!file.bkmvProcessingResult) {
      return NextResponse.json(
        { error: "לקובץ אין תוצאת עיבוד BKMV קודמת" },
        { status: 400 }
      );
    }

    const previousStatus = file.processingStatus ?? "needs_review";

    const outcome = await reprocessBkmvFileById(fileId);
    if (!outcome.success) {
      return NextResponse.json(
        { error: `העיבוד נכשל: ${outcome.error}` },
        { status: 500 }
      );
    }

    // Reset to needs_review and clear prior reviewer metadata so the file
    // re-enters the review queue for fresh approval.
    await updateUploadedFileProcessingStatus(
      fileId,
      "needs_review",
      undefined,
      null,
      null
    );

    const auditContext = createAuditContext({ user }, request);
    await logAuditEvent(
      auditContext,
      "status_change",
      "document",
      fileId,
      {
        entityName: file.originalFileName,
        beforeValue: { processingStatus: previousStatus },
        afterValue: { processingStatus: "needs_review" },
        reason: "Manual reprocess from review screen",
        metadata: {
          fileId,
          fileName: file.originalFileName,
          manualMatchesPreserved: outcome.manualMatchesPreserved,
        },
      }
    );

    return NextResponse.json({
      success: true,
      fileId,
      manualMatchesPreserved: outcome.manualMatchesPreserved,
      message: "הקובץ עובד מחדש וחזר למצב דורש בדיקה",
    });
  } catch (error) {
    console.error("Error in BKMV per-file reprocess:", error);
    return NextResponse.json(
      { error: "שגיאת שרת פנימית" },
      { status: 500 }
    );
  }
}
