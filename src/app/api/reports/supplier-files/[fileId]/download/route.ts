import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getSupplierFileById } from "@/data-access/supplier-file-reports";

interface RouteParams {
  params: Promise<{ fileId: string }>;
}

/**
 * GET /api/reports/supplier-files/[fileId]/download
 * Download a supplier file by redirecting to its storage URL
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { fileId } = await params;

    if (!fileId) {
      return NextResponse.json(
        { error: "מזהה קובץ נדרש" },
        { status: 400 }
      );
    }

    // Get file from database
    const file = await getSupplierFileById(fileId);

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
    // Using permanent redirect for caching
    return NextResponse.redirect(file.fileUrl, 302);
  } catch (error) {
    console.error("Error downloading supplier file:", error);
    return NextResponse.json(
      { error: "שגיאה בהורדת הקובץ" },
      { status: 500 }
    );
  }
}
