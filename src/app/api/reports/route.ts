import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getReportData, type ReportFilters, type ReportType } from "@/data-access/reports";

/**
 * GET /api/reports - Get report data based on type and filters
 *
 * Query Parameters:
 * - reportType: Type of report (commissions, settlements, franchisees, suppliers)
 * - startDate: ISO date string for period start (optional)
 * - endDate: ISO date string for period end (optional)
 * - brandId: Filter by specific brand (optional)
 * - supplierId: Filter by specific supplier (optional)
 * - franchiseeId: Filter by specific franchisee (optional)
 * - status: Filter by status (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const reportType = (searchParams.get("reportType") as ReportType) || "commissions";

    const filters: ReportFilters = {
      reportType,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      brandId: searchParams.get("brandId") || undefined,
      supplierId: searchParams.get("supplierId") || undefined,
      franchiseeId: searchParams.get("franchiseeId") || undefined,
      status: searchParams.get("status") || undefined,
    };

    // Fetch report data
    const reportData = await getReportData(filters);

    return NextResponse.json({
      reportType,
      data: reportData,
    });
  } catch (error) {
    console.error("Error fetching report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
