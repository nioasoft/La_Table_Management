import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import { previewEmailTemplate } from "@/lib/email";

interface RouteParams {
  params: Promise<{ templateId: string }>;
}

/**
 * POST /api/email-templates/[templateId]/preview - Preview an email template with variables
 */
export async function POST(request: NextRequest, { params }: RouteParams) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin or super_user
    const userRole = (session.user as typeof session.user & { role?: string })
      .role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { templateId } = await params;
    const body = await request.json();
    const { variables = {} } = body;

    // Preview with sample data if no variables provided
    const sampleVariables = {
      entity_name: variables.entity_name || "Sample Entity",
      period: variables.period || "January 2024",
      upload_link: variables.upload_link || "https://example.com/upload/abc123",
      deadline: variables.deadline || "2024-01-31",
      brand_name: variables.brand_name || "La Table",
      ...variables,
    };

    const preview = await previewEmailTemplate(templateId, sampleVariables);

    if (!preview) {
      return NextResponse.json(
        { error: "Template not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ preview });
  } catch (error) {
    console.error("Error previewing email template:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
