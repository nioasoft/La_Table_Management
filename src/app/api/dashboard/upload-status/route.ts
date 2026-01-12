import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
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
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

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
