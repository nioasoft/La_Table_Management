import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getVarianceReportData,
  getAllBrands,
  type VarianceReportFilters,
} from "@/data-access/commissions";

/**
 * GET /api/commissions/variance - Get variance detection report data
 *
 * Query Parameters:
 * - currentStartDate: ISO date string for current period start (required)
 * - currentEndDate: ISO date string for current period end (required)
 * - previousStartDate: ISO date string for previous period start (required)
 * - previousEndDate: ISO date string for previous period end (required)
 * - brandId: Filter by specific brand (optional)
 * - varianceThreshold: Custom threshold percentage (optional, default 10)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const currentStartDate = searchParams.get("currentStartDate");
    const currentEndDate = searchParams.get("currentEndDate");
    const previousStartDate = searchParams.get("previousStartDate");
    const previousEndDate = searchParams.get("previousEndDate");
    const brandId = searchParams.get("brandId") || undefined;
    const varianceThresholdParam = searchParams.get("varianceThreshold");
    const varianceThreshold = varianceThresholdParam
      ? parseFloat(varianceThresholdParam)
      : 10;

    // Validate required parameters
    if (!currentStartDate || !currentEndDate || !previousStartDate || !previousEndDate) {
      return NextResponse.json(
        {
          error: "Missing required parameters. Please provide currentStartDate, currentEndDate, previousStartDate, and previousEndDate.",
        },
        { status: 400 }
      );
    }

    // Build filters
    const filters: VarianceReportFilters = {
      currentStartDate,
      currentEndDate,
      previousStartDate,
      previousEndDate,
      brandId,
      varianceThreshold,
    };

    // Fetch report data and filter options in parallel
    const [report, brands] = await Promise.all([
      getVarianceReportData(filters),
      getAllBrands(),
    ]);

    return NextResponse.json({
      report,
      filters: {
        brands: brands.map((b) => ({
          id: b.id,
          nameHe: b.nameHe,
          nameEn: b.nameEn,
        })),
      },
    });
  } catch (error) {
    console.error("Error fetching variance report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
