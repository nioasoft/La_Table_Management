import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getCommissionRevenueReport,
  type CommissionRevenueReportFilters,
} from "@/data-access/commission-revenue-report";

/**
 * GET /api/reports/commission-revenue - Get commission-to-revenue ratio report
 *
 * Query parameters:
 * - year: number (required)
 * - startMonth: 1-12 (required)
 * - endMonth: 1-12 (required, >= startMonth)
 * - brandId: string (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;

    const yearStr = searchParams.get("year");
    const startMonthStr = searchParams.get("startMonth");
    const endMonthStr = searchParams.get("endMonth");

    if (!yearStr || !startMonthStr || !endMonthStr) {
      return NextResponse.json(
        { error: "year, startMonth and endMonth are required" },
        { status: 400 }
      );
    }

    const year = parseInt(yearStr, 10);
    if (isNaN(year) || year < 2020 || year > 2100) {
      return NextResponse.json(
        { error: "Invalid year" },
        { status: 400 }
      );
    }

    const startMonth = parseInt(startMonthStr, 10);
    const endMonth = parseInt(endMonthStr, 10);

    if (
      isNaN(startMonth) || isNaN(endMonth) ||
      startMonth < 1 || startMonth > 12 ||
      endMonth < 1 || endMonth > 12 ||
      startMonth > endMonth
    ) {
      return NextResponse.json(
        { error: "startMonth and endMonth must be 1-12, startMonth <= endMonth" },
        { status: 400 }
      );
    }

    const filters: CommissionRevenueReportFilters = {
      year,
      startMonth,
      endMonth,
      brandId: searchParams.get("brandId") || undefined,
    };

    const report = await getCommissionRevenueReport(filters);

    return NextResponse.json({ report });
  } catch (error) {
    console.error("Error fetching commission-revenue report:", error instanceof Error ? error.stack : error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
