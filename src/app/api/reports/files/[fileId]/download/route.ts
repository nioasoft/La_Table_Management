import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getUnifiedFileByIdForDownload,
  type UnifiedFileSource,
} from "@/data-access/unified-files";

interface RouteParams {
  params: Promise<{ fileId: string }>;
}

/**
 * GET /api/reports/files/[fileId]/download
 * Download a unified file by redirecting to its storage URL
 *
 * Query params:
 * - source: "supplier" | "uploaded" (required)
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { fileId } = await params;
    const { searchParams } = new URL(request.url);
    const source = searchParams.get("source") as UnifiedFileSource | null;

    if (!fileId) {
      return NextResponse.json(
        { error: "מזהה קובץ נדרש" },
        { status: 400 }
      );
    }

    if (!source || (source !== "supplier" && source !== "uploaded")) {
      return NextResponse.json(
        { error: "מקור קובץ נדרש (supplier או uploaded)" },
        { status: 400 }
      );
    }

    // Get file from database based on source
    const file = await getUnifiedFileByIdForDownload(fileId, source);

    if (!file) {
      return NextResponse.json(
        { error: "קובץ לא נמצא" },
        { status: 404 }
      );
    }

    if (!file.fileUrl) {
      return NextResponse.json(
        { error: "קישור להורדה לא זמין" },
        { status: 404 }
      );
    }

    // Redirect to the file URL (Vercel Blob or S3/R2)
    return NextResponse.redirect(file.fileUrl, 302);
  } catch (error) {
    console.error("Error downloading file:", error);
    return NextResponse.json(
      { error: "שגיאה בהורדת הקובץ" },
      { status: 500 }
    );
  }
}
