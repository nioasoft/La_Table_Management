import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getEmailTemplates,
  getActiveEmailTemplates,
  createEmailTemplate,
  getEmailTemplateStats,
  isTemplateCodeUnique,
  isTemplateNameUnique,
  searchEmailTemplates,
  getEmailTemplatesByCategory,
} from "@/data-access/emailTemplates";
import { randomUUID } from "crypto";
import { extractVariables } from "@/lib/email";

/**
 * GET /api/email-templates - Get all email templates
 */
export async function GET(request: NextRequest) {
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

    const searchParams = request.nextUrl.searchParams;
    const filter = searchParams.get("filter");
    const search = searchParams.get("search");
    const category = searchParams.get("category");

    let templates;

    if (search) {
      templates = await searchEmailTemplates(search);
    } else if (category) {
      templates = await getEmailTemplatesByCategory(category);
    } else if (filter === "active") {
      templates = await getActiveEmailTemplates();
    } else {
      templates = await getEmailTemplates();
    }

    // Get stats if requested
    const includeStats = searchParams.get("stats") === "true";
    const stats = includeStats ? await getEmailTemplateStats() : null;

    return NextResponse.json({ templates, stats });
  } catch (error) {
    console.error("Error fetching email templates:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/email-templates - Create a new email template
 */
export async function POST(request: NextRequest) {
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

    // Validate required fields
    if (!name || !code || !subject || !bodyHtml) {
      return NextResponse.json(
        { error: "Name, code, subject, and HTML body are required" },
        { status: 400 }
      );
    }

    // Check if code is unique
    const isCodeUnique = await isTemplateCodeUnique(code);
    if (!isCodeUnique) {
      return NextResponse.json(
        { error: "Template code already exists" },
        { status: 400 }
      );
    }

    // Check if name is unique
    const isNameUnique = await isTemplateNameUnique(name);
    if (!isNameUnique) {
      return NextResponse.json(
        { error: "Template name already exists" },
        { status: 400 }
      );
    }

    // Extract variables from template content
    const subjectVars = extractVariables(subject);
    const bodyVars = extractVariables(bodyHtml);
    const textVars = bodyText ? extractVariables(bodyText) : [];
    const allVariables = [...new Set([...subjectVars, ...bodyVars, ...textVars])];

    const newTemplate = await createEmailTemplate({
      id: randomUUID(),
      name,
      code,
      subject,
      bodyHtml,
      bodyText: bodyText || null,
      description: description || null,
      category: category || null,
      variables: allVariables,
      isActive: isActive !== undefined ? isActive : true,
      createdBy: session.user.id,
    });

    return NextResponse.json({ template: newTemplate }, { status: 201 });
  } catch (error) {
    console.error("Error creating email template:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
