import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getPerFranchiseeReportData,
  getAllSuppliers,
  type PerFranchiseeReportFilters,
} from "@/data-access/commissions";

/**
 * GET /api/commissions/franchisee/[franchiseeId] - Get per-franchisee purchase report data
 *
 * Path Parameters:
 * - franchiseeId: The ID of the franchisee to generate the report for
 *
 * Query Parameters:
 * - startDate: ISO date string for period start (optional)
 * - endDate: ISO date string for period end (optional)
 * - supplierId: Filter by specific supplier (optional)
 * - status: Filter by commission status (optional)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ franchiseeId: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { franchiseeId } = await params;

    if (!franchiseeId) {
      return NextResponse.json(
        { error: "Franchisee ID is required" },
        { status: 400 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const filters: PerFranchiseeReportFilters = {
      franchiseeId,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      supplierId: searchParams.get("supplierId") || undefined,
      status: searchParams.get("status") || undefined,
    };

    // Fetch report data and filter options in parallel
    const [reportData, suppliers] = await Promise.all([
      getPerFranchiseeReportData(filters),
      getAllSuppliers(),
    ]);

    if (!reportData) {
      return NextResponse.json(
        { error: "Franchisee not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      report: reportData,
      filters: {
        suppliers: suppliers.map((s) => ({
          id: s.id,
          name: s.name,
          code: s.code,
        })),
        statuses: ["pending", "calculated", "approved", "paid", "cancelled"],
      },
    });
  } catch (error) {
    console.error("Error fetching franchisee purchase report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
