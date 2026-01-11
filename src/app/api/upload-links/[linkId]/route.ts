import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getUploadLinkById,
  updateUploadLink,
  deleteUploadLink,
  cancelUploadLink,
  type UploadLinkPeriodInfo,
} from "@/data-access/uploadLinks";

/**
 * GET /api/upload-links/[linkId] - Get a specific upload link (Admin/Super User only)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ linkId: string }> }
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

    const { linkId } = await params;
    const uploadLink = await getUploadLinkById(linkId);

    if (!uploadLink) {
      return NextResponse.json(
        { error: "Upload link not found" },
        { status: 404 }
      );
    }

    // Parse period info from metadata
    const metadata = uploadLink.metadata as Record<string, unknown> | null;
    let periodInfo: UploadLinkPeriodInfo | undefined;

    if (metadata && metadata.periodId) {
      periodInfo = {
        periodId: metadata.periodId as string,
        periodName: metadata.periodName as string | undefined,
        periodStartDate: metadata.periodStartDate as string | undefined,
        periodEndDate: metadata.periodEndDate as string | undefined,
      };
    }

    // Build the upload URL
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "http://localhost:3000";
    const url = `${baseUrl}/upload/${uploadLink.token}`;

    return NextResponse.json({
      uploadLink: {
        ...uploadLink,
        url,
        periodInfo,
      },
    });
  } catch (error) {
    console.error("Error fetching upload link:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/upload-links/[linkId] - Update an upload link (Admin/Super User only)
 *
 * Request body:
 * - status: string (optional) - "cancelled" to cancel the link
 * - name: string (optional)
 * - description: string (optional)
 * - expiresAt: string (optional) - ISO date string
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ linkId: string }> }
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

    const { linkId } = await params;
    const body = await request.json();
    const { status, name, description, expiresAt } = body;

    // Check if link exists
    const existingLink = await getUploadLinkById(linkId);
    if (!existingLink) {
      return NextResponse.json(
        { error: "Upload link not found" },
        { status: 404 }
      );
    }

    // If cancelling, use the dedicated function
    if (status === "cancelled") {
      const cancelledLink = await cancelUploadLink(linkId);
      return NextResponse.json({ uploadLink: cancelledLink });
    }

    // Build update data
    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (description !== undefined) updateData.description = description;
    if (expiresAt !== undefined) updateData.expiresAt = new Date(expiresAt);
    if (status !== undefined) updateData.status = status;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No update data provided" },
        { status: 400 }
      );
    }

    const updatedLink = await updateUploadLink(linkId, updateData);

    return NextResponse.json({ uploadLink: updatedLink });
  } catch (error) {
    console.error("Error updating upload link:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/upload-links/[linkId] - Delete an upload link (Admin/Super User only)
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ linkId: string }> }
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

    const { linkId } = await params;

    // Check if link exists
    const existingLink = await getUploadLinkById(linkId);
    if (!existingLink) {
      return NextResponse.json(
        { error: "Upload link not found" },
        { status: 404 }
      );
    }

    const success = await deleteUploadLink(linkId);

    if (!success) {
      return NextResponse.json(
        { error: "Failed to delete upload link" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting upload link:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
