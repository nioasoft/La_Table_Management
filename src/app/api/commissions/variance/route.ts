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
import { varianceReportApiFiltersSchema } from "@/lib/validations/report-schemas";

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
    const rawFilters = {
      currentStartDate: searchParams.get("currentStartDate") || undefined,
      currentEndDate: searchParams.get("currentEndDate") || undefined,
      previousStartDate: searchParams.get("previousStartDate") || undefined,
      previousEndDate: searchParams.get("previousEndDate") || undefined,
      brandId: searchParams.get("brandId") || undefined,
      varianceThreshold: searchParams.get("varianceThreshold") || undefined,
    };

    // Validate filters using Zod schema
    const result = varianceReportApiFiltersSchema.safeParse(rawFilters);
    if (!result.success) {
      return NextResponse.json(
        { error: "פרמטרים לא תקינים", details: result.error.flatten() },
        { status: 400 }
      );
    }

    // Build filters - convert Date objects to ISO strings for the data access layer
    const validatedData = result.data;
    const filters: VarianceReportFilters = {
      currentStartDate: validatedData.currentStartDate.toISOString().split("T")[0],
      currentEndDate: validatedData.currentEndDate.toISOString().split("T")[0],
      previousStartDate: validatedData.previousStartDate.toISOString().split("T")[0],
      previousEndDate: validatedData.previousEndDate.toISOString().split("T")[0],
      brandId: validatedData.brandId,
      varianceThreshold: validatedData.varianceThreshold,
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
