import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError, requireRole } from "@/lib/api-middleware";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";
import { getAllowedMimeTypes } from "@/lib/storage";

/**
 * POST /api/documents/upload-url
 * Handle Vercel Blob client upload callback for document uploads.
 * This endpoint is called by @vercel/blob/client during the upload flow.
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async () => {
        const authResult = await requireAuth(request);
        if (isAuthError(authResult)) {
          throw new Error("Unauthorized");
        }

        const roleResult = await requireRole(request, ["admin", "super_user"]);
        if (isAuthError(roleResult)) {
          throw new Error("Insufficient permissions");
        }

        return {
          allowedContentTypes: getAllowedMimeTypes(),
          maximumSizeInBytes: 20 * 1024 * 1024, // 20MB
          tokenPayload: JSON.stringify({
            uploadedBy: authResult.user.email,
            uploadedAt: new Date().toISOString(),
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        console.log("Document uploaded to blob:", {
          url: blob.url,
          pathname: blob.pathname,
          tokenPayload,
        });
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error("Error in document upload URL handler:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 400 }
    );
  }
}
