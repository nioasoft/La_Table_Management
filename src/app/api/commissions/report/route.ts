import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getCommissionReportData,
  getAllBrands,
  type CommissionReportFilters,
} from "@/data-access/commissions";
import { getActiveSuppliers } from "@/data-access/suppliers";

/**
 * GET /api/commissions/report - Get commission report data
 *
 * Query Parameters:
 * - startDate: ISO date string for period start (optional)
 * - endDate: ISO date string for period end (optional)
 * - supplierId: Filter by specific supplier (optional)
 * - brandId: Filter by specific brand (optional)
 * - status: Filter by commission status (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const filters: CommissionReportFilters = {
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      supplierId: searchParams.get("supplierId") || undefined,
      brandId: searchParams.get("brandId") || undefined,
      status: searchParams.get("status") || undefined,
    };

    // Fetch report data and filter options in parallel
    const [reportData, brands, suppliers] = await Promise.all([
      getCommissionReportData(filters),
      getAllBrands(),
      getActiveSuppliers(),
    ]);

    return NextResponse.json({
      report: reportData,
      filters: {
        brands: brands.map((b) => ({
          id: b.id,
          nameHe: b.nameHe,
          nameEn: b.nameEn,
        })),
        suppliers: suppliers.map((s) => ({
          id: s.id,
          name: s.name,
          code: s.code,
        })),
        statuses: ["pending", "calculated", "approved", "paid", "cancelled"],
      },
    });
  } catch (error) {
    console.error("Error fetching commission report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
