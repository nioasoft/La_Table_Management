import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  requireRole,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getSettlementPeriods,
  getSettlementPeriodsByStatus,
  getSettlementPeriodsByType,
  getSettlementPeriodsByFranchisee,
  getSettlementStats,
  createSettlementPeriod,
  createSettlementPeriodWithType,
  getOpenSettlementPeriods,
  getPendingApprovalSettlements,
  SETTLEMENT_STATUS_TRANSITIONS,
} from "@/data-access/settlements";
import { randomUUID } from "crypto";
import type { SettlementStatus, SettlementPeriodType } from "@/db/schema";

// Valid period types
const VALID_PERIOD_TYPES: SettlementPeriodType[] = ["monthly", "quarterly", "semi_annual", "annual"];

// Valid statuses
const VALID_STATUSES: SettlementStatus[] = [
  "open", "processing", "pending_approval", "approved", "invoiced",
  "draft", "pending", "completed", "cancelled"
];

/**
 * GET /api/settlements - Get all settlement periods
 * Query params:
 * - status: Filter by status
 * - periodType: Filter by period type
 * - franchiseeId: Filter by franchisee
 * - filter: Special filters (open, pending_approval)
 * - stats: Include statistics (true/false)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireRole(request, ["super_user", "admin", "franchisee_owner"]);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status") as SettlementStatus | null;
    const periodType = searchParams.get("periodType") as SettlementPeriodType | null;
    const franchiseeId = searchParams.get("franchiseeId");
    const filter = searchParams.get("filter");
    const includeStats = searchParams.get("stats") === "true";

    let settlements;

    // Handle special filters
    if (filter === "open") {
      settlements = await getOpenSettlementPeriods();
    } else if (filter === "pending_approval") {
      settlements = await getPendingApprovalSettlements();
    } else if (status && VALID_STATUSES.includes(status)) {
      settlements = await getSettlementPeriodsByStatus(status);
    } else if (periodType && VALID_PERIOD_TYPES.includes(periodType)) {
      settlements = await getSettlementPeriodsByType(periodType);
    } else if (franchiseeId) {
      settlements = await getSettlementPeriodsByFranchisee(franchiseeId);
    } else {
      settlements = await getSettlementPeriods();
    }

    // Get stats if requested
    const stats = includeStats ? await getSettlementStats() : null;

    // Include lifecycle transitions info
    const lifecycleInfo = {
      validStatuses: VALID_STATUSES,
      validPeriodTypes: VALID_PERIOD_TYPES,
      statusTransitions: SETTLEMENT_STATUS_TRANSITIONS,
    };

    return NextResponse.json({
      settlements,
      stats,
      lifecycle: lifecycleInfo,
    });
  } catch (error) {
    console.error("Error fetching settlements:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settlements - Create a new settlement period
 * Body:
 * - franchiseeId: Required - The franchisee ID
 * - periodType: Required - The period type (monthly, quarterly, semi_annual, annual)
 * - name: Optional - Custom name (auto-generated if not provided)
 * - periodStartDate: Optional - Custom start date (auto-calculated if not provided)
 * - periodEndDate: Optional - Custom end date (auto-calculated if not provided)
 * - referenceDate: Optional - Reference date for auto-calculation (defaults to current date)
 * - Additional fields: notes, metadata, dueDate
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const {
      franchiseeId,
      periodType,
      name,
      periodStartDate,
      periodEndDate,
      referenceDate,
      notes,
      metadata,
      dueDate,
    } = body;

    // Validate required fields
    if (!franchiseeId) {
      return NextResponse.json(
        { error: "franchiseeId is required" },
        { status: 400 }
      );
    }

    if (!periodType) {
      return NextResponse.json(
        { error: "periodType is required" },
        { status: 400 }
      );
    }

    // Validate period type
    if (!VALID_PERIOD_TYPES.includes(periodType)) {
      return NextResponse.json(
        { error: `Invalid periodType. Must be one of: ${VALID_PERIOD_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    let newSettlement;

    // If custom dates are provided, use manual creation
    if (periodStartDate && periodEndDate) {
      const id = randomUUID();
      newSettlement = await createSettlementPeriod({
        id,
        name: name || `${periodType} Period`,
        franchiseeId,
        periodType,
        periodStartDate,
        periodEndDate,
        status: "open",
        notes: notes || null,
        metadata: metadata || null,
        dueDate: dueDate || null,
        createdBy: user.id,
      });
    } else {
      // Use automatic date calculation
      const refDate = referenceDate ? new Date(referenceDate) : new Date();
      newSettlement = await createSettlementPeriodWithType(
        franchiseeId,
        periodType,
        refDate,
        user.id,
        {
          name: name || undefined,
          notes: notes || null,
          metadata: metadata || null,
          dueDate: dueDate || null,
        }
      );
    }

    return NextResponse.json(
      { settlement: newSettlement },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating settlement:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
