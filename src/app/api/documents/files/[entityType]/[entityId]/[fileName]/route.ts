import { NextRequest, NextResponse } from "next/server";
import {
  requireAuth,
  isAuthError,
} from "@/lib/api-middleware";
import { readLocalFile } from "@/lib/storage";

/**
 * GET /api/documents/files/[entityType]/[entityId]/[fileName] - Serve a local file
 * This endpoint serves files stored locally when cloud storage is not configured
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entityType: string; entityId: string; fileName: string }> }
) {
  try {
    const authResult = await requireAuth(request);
    if (isAuthError(authResult)) return authResult;

    const { entityType, entityId, fileName } = await params;

    // Validate entity type
    const validEntityTypes = ["supplier", "franchisee", "brand"];
    if (!validEntityTypes.includes(entityType)) {
      return NextResponse.json(
        { error: "Invalid entity type" },
        { status: 400 }
      );
    }

    // Validate fileName to prevent directory traversal attacks
    if (fileName.includes("..") || fileName.includes("/") || fileName.includes("\\")) {
      return NextResponse.json(
        { error: "Invalid file name" },
        { status: 400 }
      );
    }

    // Read the file
    const fileBuffer = await readLocalFile(entityType, entityId, fileName);

    if (!fileBuffer) {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }

    // Determine content type from file extension
    const ext = fileName.split(".").pop()?.toLowerCase();
    const contentTypeMap: Record<string, string> = {
      pdf: "application/pdf",
      doc: "application/msword",
      docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      xls: "application/vnd.ms-excel",
      xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      jpg: "image/jpeg",
      jpeg: "image/jpeg",
      png: "image/png",
      gif: "image/gif",
      txt: "text/plain",
      csv: "text/csv",
    };

    const contentType = contentTypeMap[ext || ""] || "application/octet-stream";

    // Return the file
    return new NextResponse(new Uint8Array(fileBuffer), {
      headers: {
        "Content-Type": contentType,
        "Content-Disposition": `inline; filename="${fileName}"`,
        "Cache-Control": "private, max-age=3600",
      },
    });
  } catch (error) {
    console.error("Error serving file:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
