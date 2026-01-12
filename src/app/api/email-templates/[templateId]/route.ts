import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  requireSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getEmailTemplateById,
  updateEmailTemplate,
  deleteEmailTemplate,
  toggleEmailTemplateStatus,
  isTemplateCodeUnique,
  isTemplateNameUnique,
} from "@/data-access/emailTemplates";
import { extractVariables } from "@/lib/email";

interface RouteParams {
  params: Promise<{ templateId: string }>;
}

/**
 * GET /api/email-templates/[templateId] - Get a single email template
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { templateId } = await params;
    const template = await getEmailTemplateById(templateId);

    if (!template) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ template });
  } catch (error) {
    console.error("Error fetching email template:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/email-templates/[templateId] - Update an email template
 */
export async function PUT(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { templateId } = await params;
    const existingTemplate = await getEmailTemplateById(templateId);

    if (!existingTemplate) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const {
      name,
      code,
      subject,
      bodyHtml,
      bodyText,
      description,
      category,
      isActive,
    } = body;

    // Check if code is unique (excluding current template)
    if (code && code !== existingTemplate.code) {
      const isCodeUnique = await isTemplateCodeUnique(code, templateId);
      if (!isCodeUnique) {
        return NextResponse.json(
          { error: "Template code already exists" },
          { status: 400 }
        );
      }
    }

    // Check if name is unique (excluding current template)
    if (name && name !== existingTemplate.name) {
      const isNameUnique = await isTemplateNameUnique(name, templateId);
      if (!isNameUnique) {
        return NextResponse.json(
          { error: "Template name already exists" },
          { status: 400 }
        );
      }
    }

    // Extract variables from template content
    const subjectVars = subject
      ? extractVariables(subject)
      : extractVariables(existingTemplate.subject);
    const bodyVars = bodyHtml
      ? extractVariables(bodyHtml)
      : extractVariables(existingTemplate.bodyHtml);
    const textVars =
      bodyText !== undefined
        ? bodyText
          ? extractVariables(bodyText)
          : []
        : existingTemplate.bodyText
          ? extractVariables(existingTemplate.bodyText)
          : [];
    const allVariables = [...new Set([...subjectVars, ...bodyVars, ...textVars])];

    const updatedTemplate = await updateEmailTemplate(templateId, {
      name: name || undefined,
      code: code || undefined,
      subject: subject || undefined,
      bodyHtml: bodyHtml || undefined,
      bodyText: bodyText !== undefined ? bodyText : undefined,
      description: description !== undefined ? description : undefined,
      category: category !== undefined ? category : undefined,
      isActive: isActive !== undefined ? isActive : undefined,
      variables: allVariables,
    });

    return NextResponse.json({ template: updatedTemplate });
  } catch (error) {
    console.error("Error updating email template:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/email-templates/[templateId] - Delete an email template
 */
export async function DELETE(request: NextRequest, { params }: RouteParams) {
  try {
    // Only super_user can delete
    const authResult = await requireSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { templateId } = await params;
    const existingTemplate = await getEmailTemplateById(templateId);

    if (!existingTemplate) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    const deleted = await deleteEmailTemplate(templateId);

    if (!deleted) {
      return NextResponse.json(
        { error: "Failed to delete template" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting email template:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/email-templates/[templateId] - Toggle template status
 */
export async function PATCH(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { templateId } = await params;
    const body = await request.json();

    // If toggling status
    if (body.action === "toggle_status") {
      const template = await toggleEmailTemplateStatus(templateId);

      if (!template) {
        return NextResponse.json(
          { error: "Template not found" },
          { status: 404 }
        );
      }

      return NextResponse.json({ template });
    }

    return NextResponse.json({ error: "Invalid action" }, { status: 400 });
  } catch (error) {
    console.error("Error patching email template:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
