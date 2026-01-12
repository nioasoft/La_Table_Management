import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
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
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

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
      createdBy: user.id,
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
