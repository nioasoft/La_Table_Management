import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getFileRequestById,
  updateFileRequest,
  updateFileRequestStatus,
  cancelFileRequest,
  deleteFileRequest,
  sendFileRequestEmail,
} from "@/data-access/fileRequests";
import type { FileRequestStatus } from "@/db/schema";

interface RouteParams {
  params: Promise<{ requestId: string }>;
}

/**
 * GET /api/file-requests/[requestId] - Get a single file request
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { requestId } = await params;
    const fileRequest = await getFileRequestById(requestId);

    if (!fileRequest) {
      return NextResponse.json(
        { error: "File request not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ fileRequest });
  } catch (error) {
    console.error("Error fetching file request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/file-requests/[requestId] - Update a file request
 *
 * Request body:
 * - status: FileRequestStatus (optional)
 * - description: string (optional)
 * - dueDate: YYYY-MM-DD string (optional)
 * - scheduledFor: ISO date string (optional)
 * - emailTemplateId: string (optional)
 * - metadata: object (optional)
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { requestId } = await params;
    const existingRequest = await getFileRequestById(requestId);

    if (!existingRequest) {
      return NextResponse.json(
        { error: "File request not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const {
      status,
      description,
      dueDate,
      scheduledFor,
      emailTemplateId,
      metadata,
    } = body;

    // Validate status if provided
    const validStatuses: FileRequestStatus[] = [
      "pending",
      "sent",
      "in_progress",
      "submitted",
      "expired",
      "cancelled",
    ];
    if (status && !validStatuses.includes(status)) {
      return NextResponse.json(
        { error: "Invalid status value" },
        { status: 400 }
      );
    }

    // Validate dueDate if provided
    if (dueDate) {
      const dueDateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dueDateRegex.test(dueDate)) {
        return NextResponse.json(
          { error: "dueDate must be in YYYY-MM-DD format" },
          { status: 400 }
        );
      }
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (description !== undefined) updateData.description = description;
    if (dueDate !== undefined) updateData.dueDate = dueDate;
    if (emailTemplateId !== undefined)
      updateData.emailTemplateId = emailTemplateId;
    if (metadata !== undefined) updateData.metadata = metadata;
    if (scheduledFor !== undefined) {
      updateData.scheduledFor = scheduledFor ? new Date(scheduledFor) : null;
    }

    // Update the file request
    let updatedRequest;
    if (status) {
      updatedRequest = await updateFileRequestStatus(requestId, status);
    }

    if (Object.keys(updateData).length > 0) {
      updatedRequest = await updateFileRequest(requestId, updateData);
    }

    // Fetch the updated request with full details
    const finalRequest = await getFileRequestById(requestId);

    return NextResponse.json({ fileRequest: finalRequest });
  } catch (error) {
    console.error("Error updating file request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/file-requests/[requestId] - Cancel/Delete a file request
 *
 * Query params:
 * - hard: if "true", permanently delete the request; otherwise, just cancel it
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { requestId } = await params;
    const existingRequest = await getFileRequestById(requestId);

    if (!existingRequest) {
      return NextResponse.json(
        { error: "File request not found" },
        { status: 404 }
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const hardDelete = searchParams.get("hard") === "true";

    if (hardDelete) {
      // Permanently delete
      const deleted = await deleteFileRequest(requestId);
      if (!deleted) {
        return NextResponse.json(
          { error: "Failed to delete file request" },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true, deleted: true });
    } else {
      // Soft delete - just cancel
      const cancelled = await cancelFileRequest(requestId);
      if (!cancelled) {
        return NextResponse.json(
          { error: "Failed to cancel file request" },
          { status: 500 }
        );
      }
      return NextResponse.json({ success: true, fileRequest: cancelled });
    }
  } catch (error) {
    console.error("Error deleting file request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
