import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getSupplierFilesNeedingReview,
  reviewSupplierFile,
  getSupplierFileById,
  getSupplierFileReviewStats,
} from "@/data-access/supplier-file-uploads";
import { logAuditEvent, createAuditContext } from "@/data-access/auditLog";

/**
 * GET /api/supplier-files/review - Get all supplier files needing review
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Get files needing review
    const files = await getSupplierFilesNeedingReview();

    // Get review stats for summary cards
    const stats = await getSupplierFileReviewStats();

    // Format response
    const formattedFiles = files.map((file) => ({
      id: file.id,
      fileName: file.originalFileName,
      fileSize: file.fileSize,
      uploadedAt: file.createdAt,
      processingStatus: file.processingStatus,
      supplier: {
        id: file.supplierId,
        name: file.supplierName,
        code: file.supplierCode,
      },
      processingResult: file.processingResult
        ? {
            totalRows: file.processingResult.totalRows,
            processedRows: file.processingResult.processedRows,
            matchStats: file.processingResult.matchStats,
            processedAt: file.processingResult.processedAt,
          }
        : null,
      periodStartDate: file.periodStartDate,
      periodEndDate: file.periodEndDate,
    }));

    return NextResponse.json({
      files: formattedFiles,
      total: formattedFiles.length,
      stats,
    });
  } catch (error) {
    console.error("Error fetching supplier files needing review:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/supplier-files/review - Approve or reject a supplier file
 * Body: { fileId: string, action: "approve" | "reject", notes?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const { fileId, action, notes } = body;

    if (!fileId) {
      return NextResponse.json(
        { error: "מזהה הקובץ הוא שדה חובה" },
        { status: 400 }
      );
    }

    if (!action || !["approve", "reject"].includes(action)) {
      return NextResponse.json(
        { error: "פעולה חייבת להיות 'approve' או 'reject'" },
        { status: 400 }
      );
    }

    // Get the file to verify it exists
    const file = await getSupplierFileById(fileId);
    if (!file) {
      return NextResponse.json(
        { error: "הקובץ לא נמצא" },
        { status: 404 }
      );
    }

    // Validate file is in reviewable state
    if (file.processingStatus !== "needs_review") {
      return NextResponse.json(
        { error: "הקובץ אינו במצב הממתין לבדיקה" },
        { status: 400 }
      );
    }

    const previousStatus = file.processingStatus;

    // Update the file status
    const updatedFile = await reviewSupplierFile(
      fileId,
      action,
      user.id,
      notes || undefined
    );

    // Create audit log entry
    const auditContext = createAuditContext({ user }, request);
    await logAuditEvent(
      auditContext,
      action as "approve" | "reject",
      "document",
      fileId,
      {
        entityName: file.originalFileName,
        beforeValue: { processingStatus: previousStatus },
        afterValue: {
          processingStatus: action === "approve" ? "approved" : "rejected",
          reviewedBy: user.id,
        },
        notes: notes || undefined,
        metadata: {
          fileId,
          fileName: file.originalFileName,
          fileSize: file.fileSize,
          supplierId: file.supplierId,
          supplierName: file.supplierName,
        },
      }
    );

    return NextResponse.json({
      success: true,
      file: updatedFile,
      message: action === "approve" ? "הקובץ אושר בהצלחה" : "הקובץ נדחה",
    });
  } catch (error) {
    console.error("Error processing supplier file review action:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
