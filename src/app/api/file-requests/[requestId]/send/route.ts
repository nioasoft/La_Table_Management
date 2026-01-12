import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getFileRequestById,
  sendFileRequestEmail,
  sendFileRequestReminder,
} from "@/data-access/fileRequests";

interface RouteParams {
  params: Promise<{ requestId: string }>;
}

/**
 * POST /api/file-requests/[requestId]/send - Send or resend file request email
 *
 * Request body:
 * - templateId: string (optional) - Override the template to use
 * - variables: object (optional) - Additional template variables
 * - isReminder: boolean (optional) - Send as a reminder instead of initial email
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
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

    // Check if request is in a valid state to send
    if (fileRequest.status === "cancelled") {
      return NextResponse.json(
        { error: "Cannot send email for cancelled request" },
        { status: 400 }
      );
    }

    if (fileRequest.status === "expired") {
      return NextResponse.json(
        { error: "Cannot send email for expired request" },
        { status: 400 }
      );
    }

    if (fileRequest.status === "submitted") {
      return NextResponse.json(
        { error: "Cannot send email for already submitted request" },
        { status: 400 }
      );
    }

    const body = await request.json().catch(() => ({}));
    const { templateId, variables, isReminder } = body;

    let result;

    if (isReminder && fileRequest.status === "sent") {
      // Send as reminder
      result = await sendFileRequestReminder(requestId, templateId);
    } else {
      // Send or resend the email
      result = await sendFileRequestEmail({
        fileRequestId: requestId,
        templateId,
        variables,
      });
    }

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to send email" },
        { status: 500 }
      );
    }

    // Fetch the updated request
    const updatedRequest = await getFileRequestById(requestId);

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
      fileRequest: updatedRequest,
    });
  } catch (error) {
    console.error("Error sending file request email:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
