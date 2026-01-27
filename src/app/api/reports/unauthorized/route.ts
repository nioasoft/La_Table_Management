import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getUnauthorizedSuppliersReport,
  getUnauthorizedSuppliersFilterOptions,
} from "@/data-access/unauthorized-suppliers";
import { unauthorizedSuppliersFiltersSchema } from "@/lib/validations/report-schemas";
import { formatDateAsLocal } from "@/lib/date-utils";

/**
 * GET /api/reports/unauthorized
 * Get unauthorized suppliers report
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const rawFilters = {
      brandId: searchParams.get("brandId") || undefined,
      franchiseeId: searchParams.get("franchiseeId") || undefined,
      supplierName: searchParams.get("supplierName") || undefined,
      periodKey: searchParams.get("periodKey") || undefined,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      minAmount: searchParams.get("minAmount") || undefined,
      maxAmount: searchParams.get("maxAmount") || undefined,
    };

    // Validate filters using Zod schema
    const result = unauthorizedSuppliersFiltersSchema.safeParse(rawFilters);
    if (!result.success) {
      return NextResponse.json(
        { error: "פרמטרים לא תקינים", details: result.error.flatten() },
        { status: 400 }
      );
    }

    const validatedData = result.data;

    // Convert Date objects to strings for the data access layer
    const filters = {
      brandId: validatedData.brandId,
      franchiseeId: validatedData.franchiseeId,
      startDate: validatedData.startDate ? formatDateAsLocal(validatedData.startDate) : undefined,
      endDate: validatedData.endDate ? formatDateAsLocal(validatedData.endDate) : undefined,
      minAmount: validatedData.minAmount,
    };

    // Get report data and filter options in parallel
    const [report, filterOptions] = await Promise.all([
      getUnauthorizedSuppliersReport(filters),
      getUnauthorizedSuppliersFilterOptions(),
    ]);

    return NextResponse.json({
      report,
      filters: filterOptions,
    });
  } catch (error) {
    console.error("Error generating unauthorized suppliers report:", error);
    return NextResponse.json(
      { error: "Failed to generate report" },
      { status: 500 }
    );
  }
}
