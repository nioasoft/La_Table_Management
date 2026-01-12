import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { sendEmailWithTemplate, validateTemplateVariables } from "@/lib/email";
import { getEmailTemplateById } from "@/data-access/emailTemplates";

interface RouteParams {
  params: Promise<{ templateId: string }>;
}

/**
 * POST /api/email-templates/[templateId]/send - Send an email using a template
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { templateId } = await params;
    const body = await request.json();
    const { to, toName, variables = {}, entityType, entityId, replyTo } = body;

    // Validate required fields
    if (!to) {
      return NextResponse.json(
        { error: "Recipient email (to) is required" },
        { status: 400 }
      );
    }

    // Validate email format
    const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
    if (!emailRegex.test(to)) {
      return NextResponse.json(
        { error: "Invalid email address" },
        { status: 400 }
      );
    }

    // Get template to validate variables
    const template = await getEmailTemplateById(templateId);
    if (!template) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    // Validate required variables
    const missingVariables = validateTemplateVariables(template, variables);
    if (missingVariables.length > 0) {
      return NextResponse.json(
        {
          error: "Missing required template variables",
          missingVariables,
        },
        { status: 400 }
      );
    }

    // Send the email
    const result = await sendEmailWithTemplate(templateId, variables, {
      to,
      toName,
      entityType,
      entityId,
      replyTo,
      metadata: {
        sentBy: user.id,
        sentAt: new Date().toISOString(),
      },
    });

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to send email" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      messageId: result.messageId,
    });
  } catch (error) {
    console.error("Error sending email:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
