import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getSettlementSimpleReport,
  saveSettlementAdjustment,
  getSettlementSimpleFilterOptions,
  getAvailableSettlementPeriods,
  type SettlementSimpleFilters,
  type SaveAdjustmentData,
} from "@/data-access/settlement-simple";
import { type AdjustmentType } from "@/db/schema";

/**
 * GET /api/settlement-simple - Get settlement reconciliation report
 *
 * Query Parameters:
 * - periodStartDate: Start date (required)
 * - periodEndDate: End date (required)
 * - supplierId: Filter by supplier (optional)
 * - franchiseeId: Filter by franchisee (optional)
 * - brandId: Filter by brand (optional)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);

    // Check for filters or fetch filter options
    const periodStartDate = searchParams.get("periodStartDate");
    const periodEndDate = searchParams.get("periodEndDate");

    // If no period dates provided, return filter options
    if (!periodStartDate || !periodEndDate) {
      const filterOptions = await getSettlementSimpleFilterOptions();
      const periods = await getAvailableSettlementPeriods();

      return NextResponse.json({
        filterOptions,
        periods,
        report: null,
      });
    }

    // Build filters
    const filters: SettlementSimpleFilters = {
      periodStartDate,
      periodEndDate,
      supplierId: searchParams.get("supplierId") || undefined,
      franchiseeId: searchParams.get("franchiseeId") || undefined,
      brandId: searchParams.get("brandId") || undefined,
    };

    // Get report data
    const report = await getSettlementSimpleReport(filters);
    const filterOptions = await getSettlementSimpleFilterOptions();
    const periods = await getAvailableSettlementPeriods();

    return NextResponse.json({
      report,
      filterOptions,
      periods,
    });
  } catch (error) {
    console.error("Error fetching settlement report:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settlement-simple - Save an adjustment
 *
 * Body:
 * - commissionId: Commission ID to adjust
 * - adjustmentAmount: Amount of adjustment
 * - reason: Adjustment type (timing, deposit, supplier_error, other)
 * - notes: Optional notes
 * - settlementPeriodId: Optional settlement period ID
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const body = await request.json();

    // Validate required fields
    if (!body.commissionId) {
      return NextResponse.json(
        { error: "Missing required field: commissionId" },
        { status: 400 }
      );
    }

    if (body.adjustmentAmount === undefined || body.adjustmentAmount === null) {
      return NextResponse.json(
        { error: "Missing required field: adjustmentAmount" },
        { status: 400 }
      );
    }

    if (!body.reason) {
      return NextResponse.json(
        { error: "Missing required field: reason" },
        { status: 400 }
      );
    }

    // Validate reason is a valid adjustment type
    const validReasons: AdjustmentType[] = [
      "timing",
      "deposit",
      "supplier_error",
      "other",
      "credit",
      "debit",
      "refund",
      "penalty",
      "bonus",
    ];
    if (!validReasons.includes(body.reason as AdjustmentType)) {
      return NextResponse.json(
        { error: `Invalid reason. Must be one of: ${validReasons.join(", ")}` },
        { status: 400 }
      );
    }

    const adjustmentData: SaveAdjustmentData = {
      commissionId: body.commissionId,
      adjustmentAmount: Number(body.adjustmentAmount),
      reason: body.reason as AdjustmentType,
      notes: body.notes || undefined,
      settlementPeriodId: body.settlementPeriodId || undefined,
      createdBy: authResult.user.id,
    };

    const result = await saveSettlementAdjustment(adjustmentData);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error || "Failed to save adjustment" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      adjustmentId: result.adjustmentId,
    });
  } catch (error) {
    console.error("Error saving adjustment:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
