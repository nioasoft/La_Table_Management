import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getCrossReferencesByType,
  getReconciliationStats,
  generateReconciliationReport,
  performBulkComparison,
  DEFAULT_MATCH_THRESHOLD,
} from "@/data-access/crossReferences";

/**
 * GET /api/reconciliation - Get reconciliation data and statistics
 * Query params:
 * - stats: Include statistics (true/false)
 * - periodStartDate: Filter by period start date
 * - periodEndDate: Filter by period end date
 * - supplierId: Filter by supplier ID
 * - franchiseeId: Filter by franchisee ID
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;
    const includeStats = searchParams.get("stats") === "true";
    const periodStartDate = searchParams.get("periodStartDate");
    const periodEndDate = searchParams.get("periodEndDate");
    const supplierId = searchParams.get("supplierId");
    const franchiseeId = searchParams.get("franchiseeId");

    // If period dates are provided, generate a report
    if (periodStartDate && periodEndDate) {
      const report = await generateReconciliationReport(
        periodStartDate,
        periodEndDate,
        supplierId || undefined,
        franchiseeId || undefined
      );
      return NextResponse.json({ report });
    }

    // Get all comparisons
    const comparisons = await getCrossReferencesByType("amount_comparison");

    // Get stats if requested
    const stats = includeStats ? await getReconciliationStats() : null;

    return NextResponse.json({
      comparisons,
      stats,
      threshold: DEFAULT_MATCH_THRESHOLD,
    });
  } catch (error) {
    console.error("Error fetching reconciliation data:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/reconciliation - Perform bulk comparison for a period
 * Body:
 * - periodStartDate: Required - Period start date
 * - periodEndDate: Required - Period end date
 * - threshold: Optional - Custom matching threshold (default ₪10)
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const { periodStartDate, periodEndDate, threshold } = body;

    // Validate required fields
    if (!periodStartDate) {
      return NextResponse.json(
        { error: "periodStartDate is required" },
        { status: 400 }
      );
    }

    if (!periodEndDate) {
      return NextResponse.json(
        { error: "periodEndDate is required" },
        { status: 400 }
      );
    }

    // Perform bulk comparison
    const result = await performBulkComparison(
      periodStartDate,
      periodEndDate,
      threshold || DEFAULT_MATCH_THRESHOLD,
      user.id
    );

    return NextResponse.json(
      {
        message: "Bulk comparison completed",
        created: result.created,
        matched: result.matched,
        discrepancies: result.discrepancies,
        threshold: threshold || DEFAULT_MATCH_THRESHOLD,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error performing bulk comparison:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
