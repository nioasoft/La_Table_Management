import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getUnifiedFilesReport,
  getUnifiedFilesFilterOptions,
  type UnifiedFilesFilters,
} from "@/data-access/unified-files";
import { unifiedFilesFiltersSchema } from "@/lib/validations/report-schemas";
import { formatDateAsLocal } from "@/lib/date-utils";

/**
 * GET /api/reports/files
 * Get unified files report with filtering
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const rawFilters = {
      source: searchParams.get("source") || undefined,
      entityType: searchParams.get("entityType") || undefined,
      status: searchParams.get("status") || undefined,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
    };

    // Validate filters using Zod schema
    const result = unifiedFilesFiltersSchema.safeParse(rawFilters);
    if (!result.success) {
      return NextResponse.json(
        { error: "פרמטרים לא תקינים", details: result.error.flatten() },
        { status: 400 }
      );
    }

    const validatedData = result.data;

    // Convert Date objects to strings for the data access layer
    const filters: UnifiedFilesFilters = {
      source: validatedData.source,
      entityType: validatedData.entityType,
      status: validatedData.status,
      startDate: validatedData.startDate ? formatDateAsLocal(validatedData.startDate) : undefined,
      endDate: validatedData.endDate ? formatDateAsLocal(validatedData.endDate) : undefined,
    };

    // Get report data and filter options in parallel
    const [report, filterOptions] = await Promise.all([
      getUnifiedFilesReport(filters),
      getUnifiedFilesFilterOptions(),
    ]);

    return NextResponse.json({
      report,
      filters: filterOptions,
    });
  } catch (error) {
    console.error("Error generating unified files report:", error);
    return NextResponse.json(
      { error: "שגיאה ביצירת הדוח" },
      { status: 500 }
    );
  }
}
