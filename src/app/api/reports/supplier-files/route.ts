import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getSupplierFilesReport,
  getSupplierFilesFilterOptions,
} from "@/data-access/supplier-file-reports";
import { supplierFilesFiltersSchema } from "@/lib/validations/report-schemas";
import { formatDateAsLocal } from "@/lib/date-utils";

/**
 * GET /api/reports/supplier-files
 * Get supplier files report with filtering
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const rawFilters = {
      supplierId: searchParams.get("supplierId") || undefined,
      brandId: searchParams.get("brandId") || undefined,
      status: searchParams.get("status") || undefined,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
    };

    // Validate filters using Zod schema
    const result = supplierFilesFiltersSchema.safeParse(rawFilters);
    if (!result.success) {
      return NextResponse.json(
        { error: "פרמטרים לא תקינים", details: result.error.flatten() },
        { status: 400 }
      );
    }

    const validatedData = result.data;

    // Convert Date objects to strings for the data access layer
    const filters = {
      supplierId: validatedData.supplierId,
      brandId: validatedData.brandId,
      status: validatedData.status,
      startDate: validatedData.startDate ? formatDateAsLocal(validatedData.startDate) : undefined,
      endDate: validatedData.endDate ? formatDateAsLocal(validatedData.endDate) : undefined,
    };

    // Get report data and filter options in parallel
    const [report, filterOptions] = await Promise.all([
      getSupplierFilesReport(filters),
      getSupplierFilesFilterOptions(),
    ]);

    return NextResponse.json({
      report,
      filters: filterOptions,
    });
  } catch (error) {
    console.error("Error generating supplier files report:", error);
    return NextResponse.json(
      { error: "שגיאה ביצירת הדוח" },
      { status: 500 }
    );
  }
}
