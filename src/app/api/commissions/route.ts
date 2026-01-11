import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  calculateAndCreateCommission,
  calculateBatchCommissions,
  getCommissionsWithDetails,
  type CommissionCalculationInput,
  type BatchCommissionInput,
  type CommissionReportFilters,
} from "@/data-access/commissions";
import { createAuditContext } from "@/data-access/auditLog";

/**
 * GET /api/commissions - Get commissions with optional filters
 *
 * Query Parameters:
 * - startDate: Filter by period start date
 * - endDate: Filter by period end date
 * - supplierId: Filter by supplier
 * - brandId: Filter by brand
 * - status: Filter by status (pending/calculated/approved/paid/cancelled)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;

    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { searchParams } = new URL(request.url);
    const filters: CommissionReportFilters = {
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      supplierId: searchParams.get("supplierId") || undefined,
      brandId: searchParams.get("brandId") || undefined,
      status: searchParams.get("status") || undefined,
    };

    const commissions = await getCommissionsWithDetails(filters);

    return NextResponse.json({
      commissions,
      count: commissions.length,
    });
  } catch (error) {
    console.error("Error fetching commissions:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/commissions - Calculate and create commissions
 *
 * Request body can be either:
 * 1. Single commission calculation:
 *    {
 *      supplierId: string,
 *      franchiseeId: string,
 *      periodStartDate: string,
 *      periodEndDate: string,
 *      grossAmount: number,
 *      netAmount: number,
 *      vatAdjusted: boolean,
 *      settlementPeriodId?: string,
 *      notes?: string,
 *      metadata?: object
 *    }
 *
 * 2. Batch commission calculation:
 *    {
 *      batch: true,
 *      supplierId: string,
 *      periodStartDate: string,
 *      periodEndDate: string,
 *      settlementPeriodId?: string,
 *      transactions: Array<{
 *        franchiseeId: string,
 *        grossAmount: number,
 *        netAmount: number,
 *        vatAdjusted: boolean,
 *        notes?: string,
 *        metadata?: object
 *      }>
 *    }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;

    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const auditContext = createAuditContext(
      { user: { id: session.user.id, name: session.user.name, email: session.user.email } },
      request
    );

    // Check if this is a batch request
    if (body.batch === true) {
      // Validate batch input
      if (!body.supplierId || !body.periodStartDate || !body.periodEndDate) {
        return NextResponse.json(
          { error: "Missing required fields: supplierId, periodStartDate, periodEndDate" },
          { status: 400 }
        );
      }

      if (!body.transactions || !Array.isArray(body.transactions) || body.transactions.length === 0) {
        return NextResponse.json(
          { error: "Transactions array is required for batch processing" },
          { status: 400 }
        );
      }

      const batchInput: BatchCommissionInput = {
        supplierId: body.supplierId,
        periodStartDate: body.periodStartDate,
        periodEndDate: body.periodEndDate,
        settlementPeriodId: body.settlementPeriodId,
        transactions: body.transactions,
        createdBy: session.user.id,
      };

      const result = await calculateBatchCommissions(batchInput, auditContext);

      return NextResponse.json({
        success: result.success,
        totalCreated: result.totalCreated,
        totalFailed: result.totalFailed,
        commissions: result.commissions,
        errors: result.errors,
        summary: result.summary,
      });
    }

    // Single commission calculation
    // Validate required fields
    if (!body.supplierId || !body.franchiseeId || !body.periodStartDate || !body.periodEndDate) {
      return NextResponse.json(
        { error: "Missing required fields: supplierId, franchiseeId, periodStartDate, periodEndDate" },
        { status: 400 }
      );
    }

    if (body.grossAmount === undefined || body.netAmount === undefined) {
      return NextResponse.json(
        { error: "Missing required fields: grossAmount, netAmount" },
        { status: 400 }
      );
    }

    const input: CommissionCalculationInput = {
      supplierId: body.supplierId,
      franchiseeId: body.franchiseeId,
      periodStartDate: body.periodStartDate,
      periodEndDate: body.periodEndDate,
      grossAmount: body.grossAmount,
      netAmount: body.netAmount,
      vatAdjusted: body.vatAdjusted ?? false,
      settlementPeriodId: body.settlementPeriodId,
      notes: body.notes,
      metadata: body.metadata,
      createdBy: session.user.id,
    };

    const result = await calculateAndCreateCommission(input, auditContext);

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      commission: result.commission,
    });
  } catch (error) {
    console.error("Error creating commission:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
