import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import { getFileRequestStats } from "@/data-access/fileRequests";

/**
 * GET /api/file-requests/stats - Get file request statistics
 */
export async function GET(request: NextRequest) {
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
