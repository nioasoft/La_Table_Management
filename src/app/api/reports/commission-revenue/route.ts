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
 * - quarter: 1|2|3|4|annual (required)
 * - brandId: string (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;

    const yearStr = searchParams.get("year");
    const quarterStr = searchParams.get("quarter");

    if (!yearStr || !quarterStr) {
      return NextResponse.json(
        { error: "year and quarter are required" },
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

    let quarter: 1 | 2 | 3 | 4 | "annual";
    if (quarterStr === "annual") {
      quarter = "annual";
    } else {
      const q = parseInt(quarterStr, 10);
      if (![1, 2, 3, 4].includes(q)) {
        return NextResponse.json(
          { error: "Quarter must be 1, 2, 3, 4, or 'annual'" },
          { status: 400 }
        );
      }
      quarter = q as 1 | 2 | 3 | 4;
    }

    const filters: CommissionRevenueReportFilters = {
      year,
      quarter,
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
