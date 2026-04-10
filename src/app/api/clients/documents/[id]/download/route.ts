import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getClientDocumentById } from "@/data-access/client-documents";

interface RouteParams {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/clients/documents/[id]/download
 * Download a client document by redirecting to its storage URL
 */
export async function GET(request: NextRequest, { params }: RouteParams) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;

    if (!id) {
      return NextResponse.json(
        { error: "מזהה מסמך נדרש" },
        { status: 400 }
      );
    }

    const doc = await getClientDocumentById(id);

    if (!doc) {
      return NextResponse.json(
        { error: "מסמך לא נמצא" },
        { status: 404 }
      );
    }

    if (!doc.fileUrl) {
      return NextResponse.json(
        { error: "קישור להורדה לא זמין" },
        { status: 404 }
      );
    }

    return NextResponse.redirect(doc.fileUrl, 302);
  } catch (error) {
    console.error("Error downloading client document:", error);
    return NextResponse.json(
      { error: "שגיאה בהורדת המסמך" },
      { status: 500 }
    );
  }
}
