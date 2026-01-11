import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getDashboardUploadStatus,
  type DashboardUploadStatus,
} from "@/data-access/uploadLinks";

/**
 * Upload status response type for dashboard widget
 */
export type UploadStatusResponse = DashboardUploadStatus;

/**
 * GET /api/dashboard/upload-status - Get upload status for dashboard widget
 * Returns:
 * - Suppliers: list with upload status (who has uploaded, who hasn't)
 * - Franchisees: list with upload status (who has uploaded, who hasn't)
 * - Pending upload links with expiry dates
 * - Summary statistics
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user has permission (admin or super_user)
    const userRole = (session.user as typeof session.user & { role?: string }).role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    // Fetch upload status for all entities
    const uploadStatus = await getDashboardUploadStatus();

    return NextResponse.json(uploadStatus);
  } catch (error) {
    console.error("Error fetching upload status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
