import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError, requireRole } from "@/lib/api-middleware";
import { getBkmvUploadHistory } from "@/data-access/uploadLinks";
import type { BkmvProcessingResult } from "@/db/schema";

/**
 * GET /api/bkmvdata/history
 * Get BKMVDATA upload history with filters
 */
export async function GET(request: NextRequest) {
  try {
    // Auth check
    const authResult = await requireAuth(request);
    if (isAuthError(authResult)) return authResult;

    // Role check - admin or super_user only
    const roleResult = await requireRole(request, ["admin", "super_user"]);
    if (isAuthError(roleResult)) return roleResult;

    // Parse query params
    const { searchParams } = new URL(request.url);
    const franchiseeId = searchParams.get("franchiseeId") || undefined;
    const periodStartDate = searchParams.get("periodStartDate") || undefined;
    const periodEndDate = searchParams.get("periodEndDate") || undefined;
    const statusParam = searchParams.get("status");
    const status = statusParam ? statusParam.split(",") : undefined;
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);

    // Get history
    const result = await getBkmvUploadHistory({
      franchiseeId,
      periodStartDate,
      periodEndDate,
      status,
      limit,
      offset,
    });

    // Format response
    const files = result.files.map(file => {
      const processingResult = file.bkmvProcessingResult as BkmvProcessingResult | null;
      return {
        id: file.id,
        fileName: file.originalFileName,
        fileSize: file.fileSize,
        fileUrl: file.fileUrl,
        processingStatus: file.processingStatus,
        periodStartDate: file.periodStartDate,
        periodEndDate: file.periodEndDate,
        createdAt: file.createdAt,
        franchisee: file.franchisee ? {
          id: file.franchisee.id,
          name: file.franchisee.name,
          code: file.franchisee.code,
        } : null,
        matchStats: processingResult?.matchStats || null,
        companyId: processingResult?.companyId || null,
      };
    });

    return NextResponse.json({
      files,
      total: result.total,
      limit,
      offset,
    });
  } catch (error) {
    console.error("Error fetching BKMVDATA history:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
