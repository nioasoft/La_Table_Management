import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getPerBrandReportData,
  getAllSuppliers,
  type PerBrandReportFilters,
} from "@/data-access/commissions";

/**
 * GET /api/commissions/brand/[brandId] - Get per-brand commission report data
 *
 * Query Parameters:
 * - startDate: ISO date string for period start (optional)
 * - endDate: ISO date string for period end (optional)
 * - supplierId: Filter by specific supplier (optional)
 * - status: Filter by commission status (optional)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ brandId: string }> }
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

    const { brandId } = await params;

    if (!brandId) {
      return NextResponse.json(
        { error: "Brand ID is required" },
        { status: 400 }
      );
    }

    // Parse query parameters
    const { searchParams } = new URL(request.url);
    const filters: PerBrandReportFilters = {
      brandId,
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      supplierId: searchParams.get("supplierId") || undefined,
      status: searchParams.get("status") || undefined,
    };

    // Fetch report data and filter options in parallel
    const [reportData, suppliers] = await Promise.all([
      getPerBrandReportData(filters),
      getAllSuppliers(),
    ]);

    if (!reportData) {
      return NextResponse.json(
        { error: "Brand not found" },
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
    console.error("Error fetching per-brand commission report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
