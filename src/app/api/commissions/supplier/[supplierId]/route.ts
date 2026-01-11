import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getPerSupplierReportData,
  getAllBrands,
  type PerSupplierReportFilters,
} from "@/data-access/commissions";

/**
 * GET /api/commissions/supplier/[supplierId] - Get per-supplier commission report data
 *
 * Query Parameters:
 * - startDate: ISO date string for period start (optional)
 * - endDate: ISO date string for period end (optional)
 * - brandId: Filter by specific brand (optional)
 * - status: Filter by commission status (optional)
 * - compareStartDate: ISO date string for comparison period start (optional)
 * - compareEndDate: ISO date string for comparison period end (optional)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ supplierId: string }> }
) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;

    // Only admins and super users can view commission reports
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { supplierId } = await params;

    if (!supplierId) {
      return NextResponse.json(
        { error: "Supplier ID is required" },
        { status: 400 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const filters: PerSupplierReportFilters = {
      supplierId,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      brandId: searchParams.get("brandId") || undefined,
      status: searchParams.get("status") || undefined,
      compareStartDate: searchParams.get("compareStartDate") || undefined,
      compareEndDate: searchParams.get("compareEndDate") || undefined,
    };

    // Fetch report data and filter options in parallel
    const [reportData, brands] = await Promise.all([
      getPerSupplierReportData(filters),
      getAllBrands(),
    ]);

    if (!reportData) {
      return NextResponse.json(
        { error: "Supplier not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      report: reportData,
      filters: {
        brands: brands.map((b) => ({
          id: b.id,
          nameHe: b.nameHe,
          nameEn: b.nameEn,
        })),
        statuses: ["pending", "calculated", "approved", "paid", "cancelled"],
      },
    });
  } catch (error) {
    console.error("Error fetching per-supplier commission report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
