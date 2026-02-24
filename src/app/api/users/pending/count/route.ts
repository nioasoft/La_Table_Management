import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getPendingUsersCount } from "@/data-access/users";

/**
 * GET /api/users/pending/count - Get count of users awaiting approval
 * Used for sidebar badge
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const count = await getPendingUsersCount();

    return NextResponse.json({ count });
  } catch (error) {
    console.error("[users/pending/count] Error:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
