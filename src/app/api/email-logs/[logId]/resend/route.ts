import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getEmailLogById } from "@/data-access/emailTemplates";
import { sendDirectEmail } from "@/lib/email";

interface RouteParams {
  params: Promise<{ logId: string }>;
}

/**
 * POST /api/email-logs/[logId]/resend - Resend a failed/bounced email
 * Creates a new email log entry; the original remains as audit trail.
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { logId } = await params;

    const emailLog = await getEmailLogById(logId);
    if (!emailLog) {
      return NextResponse.json(
        { error: "Email log not found" },
        { status: 404 }
      );
    }

    // Only allow resending failed or bounced emails
    if (emailLog.status !== "failed" && emailLog.status !== "bounced") {
      return NextResponse.json(
        { error: "Only failed or bounced emails can be resent" },
        { status: 400 }
      );
    }

    if (!emailLog.toEmail || !emailLog.bodyHtml) {
      return NextResponse.json(
        { error: "Email log is missing required content for resending" },
        { status: 400 }
      );
    }

    const result = await sendDirectEmail({
      to: emailLog.toEmail,
      subject: emailLog.subject,
      html: emailLog.bodyHtml,
      text: emailLog.bodyText || "",
      entityType: emailLog.entityType || undefined,
      entityId: emailLog.entityId || undefined,
      metadata: {
        resentFrom: logId,
        resentBy: user.id,
        resentAt: new Date().toISOString(),
      },
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to resend email" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
    });
  } catch (error) {
    console.error("Error resending email:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
