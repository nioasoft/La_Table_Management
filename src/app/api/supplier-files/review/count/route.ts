import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getSupplierFileReviewCount } from "@/data-access/supplier-file-uploads";

/**
 * GET /api/supplier-files/review/count - Get count of files needing review
 * Used for sidebar badge
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const count = await getSupplierFileReviewCount();

    return NextResponse.json({ count });
  } catch (error) {
    console.error("Error fetching supplier files review count:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
