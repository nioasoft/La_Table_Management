import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getUploadedFilesNeedingReview,
  updateUploadedFileProcessingStatus,
  getUploadedFileById,
  getUploadLinkById,
} from "@/data-access/uploadLinks";
import { getFranchiseeById } from "@/data-access/franchisees";
import { logAuditEvent, createAuditContext } from "@/data-access/auditLog";
import type { BkmvProcessingResult } from "@/db/schema";

/**
 * GET /api/bkmvdata/review - Get all files needing review
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Get files needing review
    const filesNeedingReview = await getUploadedFilesNeedingReview();

    // Enrich with upload link and franchisee info
    const enrichedFiles = await Promise.all(
      filesNeedingReview.map(async (file) => {
        // Get upload link for entity info
        const uploadLink = await getUploadLinkById(file.uploadLinkId);

        // Get franchisee if this is a franchisee upload
        let franchisee = null;
        if (uploadLink?.entityType === "franchisee") {
          franchisee = await getFranchiseeById(uploadLink.entityId);
        }

        const processingResult = file.bkmvProcessingResult as BkmvProcessingResult | null;

        return {
          id: file.id,
          fileName: file.originalFileName,
          fileSize: file.fileSize,
          uploadedAt: file.createdAt,
          uploadedByEmail: file.uploadedByEmail,
          processingStatus: file.processingStatus,
          franchisee: franchisee ? {
            id: franchisee.id,
            name: franchisee.name,
            code: franchisee.code,
          } : null,
          uploadLink: uploadLink ? {
            id: uploadLink.id,
            name: uploadLink.name,
            entityType: uploadLink.entityType,
          } : null,
          processingResult: processingResult ? {
            companyId: processingResult.companyId,
            dateRange: processingResult.dateRange,
            matchStats: processingResult.matchStats,
            processedAt: processingResult.processedAt,
          } : null,
        };
      })
    );

    return NextResponse.json({
      files: enrichedFiles,
      total: enrichedFiles.length,
    });
  } catch (error) {
    console.error("Error fetching files needing review:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/bkmvdata/review - Approve or reject a file
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
        { error: "File ID is required" },
        { status: 400 }
      );
    }

    if (!action || !["approve", "reject"].includes(action)) {
      return NextResponse.json(
        { error: "Action must be 'approve' or 'reject'" },
        { status: 400 }
      );
    }

    // Get the file
    const file = await getUploadedFileById(fileId);
    if (!file) {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }

    // Update the file status
    const newStatus = action === "approve" ? "approved" : "rejected";
    const previousStatus = file.processingStatus || "needs_review";
    const updatedFile = await updateUploadedFileProcessingStatus(
      fileId,
      newStatus,
      undefined, // Don't change processing result
      user.id,
      notes || null
    );

    // Create audit log entry for the review action
    const auditContext = createAuditContext({ user }, request);
    await logAuditEvent(
      auditContext,
      action as "approve" | "reject",
      "document",
      fileId,
      {
        entityName: file.originalFileName,
        beforeValue: { processingStatus: previousStatus },
        afterValue: { processingStatus: newStatus, reviewedBy: user.id },
        notes: notes || undefined,
        metadata: {
          fileId,
          fileName: file.originalFileName,
          fileSize: file.fileSize,
          uploadLinkId: file.uploadLinkId,
        },
      }
    );

    return NextResponse.json({
      success: true,
      file: updatedFile,
      message: action === "approve" ? "הקובץ אושר בהצלחה" : "הקובץ נדחה",
    });
  } catch (error) {
    console.error("Error processing review action:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
