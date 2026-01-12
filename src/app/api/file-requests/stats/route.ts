import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getFileRequestStats } from "@/data-access/fileRequests";

/**
 * GET /api/file-requests/stats - Get file request statistics
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const stats = await getFileRequestStats();

    return NextResponse.json({ stats });
  } catch (error) {
    console.error("Error fetching file request stats:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
