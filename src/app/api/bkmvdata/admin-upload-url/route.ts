import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError, requireRole } from "@/lib/api-middleware";
import { handleUpload, type HandleUploadBody } from "@vercel/blob/client";

/**
 * POST /api/bkmvdata/admin-upload-url
 * Handle Vercel Blob client upload callback
 * This endpoint is called by @vercel/blob/client during upload
 */
export async function POST(request: NextRequest): Promise<NextResponse> {
  // Parse the body first to check the type
  const body = (await request.json()) as HandleUploadBody;

  try {
    const jsonResponse = await handleUpload({
      body,
      request,
      onBeforeGenerateToken: async (pathname) => {
        // Auth check - only admins/super_users can upload
        const authResult = await requireAuth(request);
        if (isAuthError(authResult)) {
          throw new Error("Unauthorized");
        }

        const roleResult = await requireRole(request, ["admin", "super_user"]);
        if (isAuthError(roleResult)) {
          throw new Error("Insufficient permissions");
        }

        // Only allow .txt files for BKMVDATA
        if (!pathname.toLowerCase().endsWith(".txt")) {
          throw new Error("Only .txt files are allowed for BKMVDATA");
        }

        return {
          allowedContentTypes: ["text/plain", "application/octet-stream"],
          maximumSizeInBytes: 50 * 1024 * 1024, // 50MB limit for BKMV files
          tokenPayload: JSON.stringify({
            uploadedBy: authResult.user.email,
            uploadedAt: new Date().toISOString(),
          }),
        };
      },
      onUploadCompleted: async ({ blob, tokenPayload }) => {
        // This callback is called after the file is uploaded to Vercel Blob
        // We can log or do preliminary processing here
        console.log("BKMV file uploaded to blob:", {
          url: blob.url,
          pathname: blob.pathname,
          tokenPayload,
        });
      },
    });

    return NextResponse.json(jsonResponse);
  } catch (error) {
    console.error("Error in admin BKMVDATA upload URL handler:", error);
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "Upload failed" },
      { status: 400 }
    );
  }
}
