import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getFranchiseeFundReport,
  type FranchiseeFundReportFilters,
} from "@/data-access/franchisee-fund-report";

/**
 * GET /api/reports/franchisee-fund - Get franchisee fund report data
 *
 * Query parameters:
 * - year: number (required) - The year to report on
 * - quarter: 1|2|3|4 (required) - The quarter to report on
 * - brandId: string (optional) - Filter by brand
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;

    // Validate required parameters
    const yearStr = searchParams.get("year");
    const quarterStr = searchParams.get("quarter");

    if (!yearStr || !quarterStr) {
      return NextResponse.json(
        { error: "year and quarter are required" },
        { status: 400 }
      );
    }

    const year = parseInt(yearStr, 10);
    const quarter = parseInt(quarterStr, 10) as 1 | 2 | 3 | 4;

    if (isNaN(year) || year < 2020 || year > 2100) {
      return NextResponse.json(
        { error: "Invalid year" },
        { status: 400 }
      );
    }

    if (![1, 2, 3, 4].includes(quarter)) {
      return NextResponse.json(
        { error: "Quarter must be 1, 2, 3, or 4" },
        { status: 400 }
      );
    }

    const filters: FranchiseeFundReportFilters = {
      year,
      quarter,
      brandId: searchParams.get("brandId") || undefined,
    };

    const report = await getFranchiseeFundReport(filters);

    return NextResponse.json({ report });
  } catch (error) {
    console.error("Error fetching franchisee fund report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
