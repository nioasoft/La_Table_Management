import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
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
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;

    // Only admins and super users can view franchisee purchase reports
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

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
