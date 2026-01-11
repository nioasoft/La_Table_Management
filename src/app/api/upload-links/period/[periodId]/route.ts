import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import { generatePeriodUploadLinks } from "@/data-access/uploadLinks";

/**
 * POST /api/upload-links/period/[periodId] - Generate upload links for a settlement period
 *
 * Request body:
 * - documentTypes: array of objects (required)
 *   - name: string (required) - Name of the document type
 *   - description: string (optional) - Description of what's needed
 *   - allowedFileTypes: string (optional) - Comma-separated MIME types
 *
 * Example:
 * {
 *   "documentTypes": [
 *     { "name": "Sales Report", "description": "Monthly sales report", "allowedFileTypes": "application/pdf" },
 *     { "name": "Invoice", "description": "Invoice for the period" }
 *   ]
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ periodId: string }> }
) {
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

    const { periodId } = await params;
    const body = await request.json();
    const { documentTypes } = body;

    // Validate required fields
    if (!documentTypes || !Array.isArray(documentTypes) || documentTypes.length === 0) {
      return NextResponse.json(
        { error: "documentTypes array is required and must not be empty" },
        { status: 400 }
      );
    }

    // Validate each document type
    for (const docType of documentTypes) {
      if (!docType.name) {
        return NextResponse.json(
          { error: "Each documentType must have a 'name' property" },
          { status: 400 }
        );
      }
    }

    // Generate upload links for the period
    const uploadLinks = await generatePeriodUploadLinks(periodId, {
      documentTypes,
      createdBy: session.user.id,
    });

    return NextResponse.json({ uploadLinks }, { status: 201 });
  } catch (error) {
    console.error("Error generating period upload links:", error);

    // Check for specific error messages
    if (error instanceof Error && error.message.includes("not found")) {
      return NextResponse.json(
        { error: error.message },
        { status: 404 }
      );
    }

    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
