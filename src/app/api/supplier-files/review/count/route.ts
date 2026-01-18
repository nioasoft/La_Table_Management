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
    console.log("[supplier-files/review/count] Starting request");

    const authResult = await requireAdminOrSuperUser(request);
    console.log("[supplier-files/review/count] Auth result:", isAuthError(authResult) ? "error" : "success");

    if (isAuthError(authResult)) return authResult;

    console.log("[supplier-files/review/count] Fetching count from DB");
    const count = await getSupplierFileReviewCount();
    console.log("[supplier-files/review/count] Count:", count);

    return NextResponse.json({ count });
  } catch (error) {
    console.error("[supplier-files/review/count] Error:", error);
    const errorMessage = error instanceof Error ? error.message : "Unknown error";
    return NextResponse.json(
      { error: "Internal server error", details: errorMessage },
      { status: 500 }
    );
  }
}
