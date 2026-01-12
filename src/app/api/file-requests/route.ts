import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  createFileRequest,
  getFileRequests,
  type GetFileRequestsOptions,
} from "@/data-access/fileRequests";
import type { FileRequestStatus } from "@/db/schema";
import type { UploadLinkEntityType } from "@/data-access/uploadLinks";

/**
 * GET /api/file-requests - Get all file requests (Admin/Super User only)
 *
 * Query params:
 * - status: filter by status (pending, sent, in_progress, submitted, expired, cancelled)
 * - entityType: filter by entity type (supplier, franchisee, brand)
 * - entityId: filter by entity ID
 * - limit: number of results
 * - offset: pagination offset
 * - includeExpired: include expired requests (default: false)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;

    const options: GetFileRequestsOptions = {
      status: (searchParams.get("status") as FileRequestStatus) || undefined,
      entityType: searchParams.get("entityType") || undefined,
      entityId: searchParams.get("entityId") || undefined,
      limit: searchParams.get("limit")
        ? parseInt(searchParams.get("limit")!, 10)
        : undefined,
      offset: searchParams.get("offset")
        ? parseInt(searchParams.get("offset")!, 10)
        : undefined,
      includeExpired: searchParams.get("includeExpired") === "true",
    };

    const fileRequests = await getFileRequests(options);

    return NextResponse.json({ fileRequests });
  } catch (error) {
    console.error("Error fetching file requests:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/file-requests - Create a new file request (Admin/Super User only)
 *
 * Request body:
 * - entityType: "supplier" | "franchisee" | "brand" (required)
 * - entityId: string (required)
 * - documentType: string (required) - Type of document requested
 * - description: string (optional)
 * - recipientEmail: string (required) - Email to send the request to
 * - recipientName: string (optional)
 * - emailTemplateId: string (optional) - Template to use for email
 * - scheduledFor: ISO date string (optional) - When to send the email
 * - dueDate: YYYY-MM-DD string (optional) - When the upload is due
 * - expiryDays: number (optional, default: 14) - Days until the link expires
 * - sendImmediately: boolean (optional, default: false) - Send email immediately
 * - metadata: object (optional) - Additional metadata
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const {
      entityType,
      entityId,
      documentType,
      description,
      recipientEmail,
      recipientName,
      emailTemplateId,
      scheduledFor,
      dueDate,
      expiryDays,
      sendImmediately,
      metadata,
    } = body;

    // Validate required fields
    if (!entityType || !entityId || !documentType || !recipientEmail) {
      return NextResponse.json(
        {
          error:
            "entityType, entityId, documentType, and recipientEmail are required",
        },
        { status: 400 }
      );
    }

    // Validate entity type
    if (!["supplier", "franchisee", "brand"].includes(entityType)) {
      return NextResponse.json(
        {
          error:
            "Invalid entityType. Must be 'supplier', 'franchisee', or 'brand'",
        },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(recipientEmail)) {
      return NextResponse.json(
        { error: "Invalid recipient email address" },
        { status: 400 }
      );
    }

    // Validate expiryDays if provided
    if (
      expiryDays !== undefined &&
      (typeof expiryDays !== "number" || expiryDays < 1 || expiryDays > 365)
    ) {
      return NextResponse.json(
        { error: "expiryDays must be a number between 1 and 365" },
        { status: 400 }
      );
    }

    // Validate scheduledFor if provided
    let scheduledDate: Date | undefined;
    if (scheduledFor) {
      scheduledDate = new Date(scheduledFor);
      if (isNaN(scheduledDate.getTime())) {
        return NextResponse.json(
          { error: "Invalid scheduledFor date format" },
          { status: 400 }
        );
      }
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

    // Create the file request
    const fileRequest = await createFileRequest({
      entityType: entityType as UploadLinkEntityType,
      entityId,
      documentType,
      description,
      recipientEmail,
      recipientName,
      emailTemplateId,
      scheduledFor: scheduledDate,
      dueDate,
      expiryDays,
      sendImmediately: sendImmediately === true,
      metadata,
      createdBy: user.id,
    });

    return NextResponse.json({ fileRequest }, { status: 201 });
  } catch (error) {
    console.error("Error creating file request:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
