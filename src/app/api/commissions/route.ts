import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  calculateAndCreateCommission,
  calculateBatchCommissions,
  getCommissionsWithDetails,
  type CommissionCalculationInput,
  type BatchCommissionInput,
} from "@/data-access/commissions";
import { createAuditContext } from "@/data-access/auditLog";
import { commissionFiltersSchema } from "@/lib/validations/report-schemas";
import { formatDateAsLocal } from "@/lib/date-utils";

const MAX_BATCH_SIZE = 100;

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
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const rawFilters = {
      startDate: searchParams.get("startDate") || undefined,
      endDate: searchParams.get("endDate") || undefined,
      supplierId: searchParams.get("supplierId") || undefined,
      franchiseeId: searchParams.get("franchiseeId") || undefined,
      brandId: searchParams.get("brandId") || undefined,
      status: searchParams.get("status") || undefined,
      periodKey: searchParams.get("periodKey") || undefined,
      minAmount: searchParams.get("minAmount") || undefined,
      maxAmount: searchParams.get("maxAmount") || undefined,
    };

    // Validate filters using Zod schema
    const result = commissionFiltersSchema.safeParse(rawFilters);
    if (!result.success) {
      return NextResponse.json(
        { error: "פרמטרים לא תקינים", details: result.error.flatten() },
        { status: 400 }
      );
    }

    const validatedData = result.data;

    // Convert Date objects to strings for the data access layer
    const filters = {
      startDate: validatedData.startDate ? formatDateAsLocal(validatedData.startDate) : undefined,
      endDate: validatedData.endDate ? formatDateAsLocal(validatedData.endDate) : undefined,
      supplierId: validatedData.supplierId,
      brandId: validatedData.brandId,
      status: validatedData.status,
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
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const auditContext = createAuditContext(
      { user: { id: user.id, name: user.name, email: user.email } },
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

      if (body.transactions.length > MAX_BATCH_SIZE) {
        return NextResponse.json(
          { error: `מקסימום ${MAX_BATCH_SIZE} פריטים בכל פעולה` },
          { status: 400 }
        );
      }

      const batchInput: BatchCommissionInput = {
        supplierId: body.supplierId,
        periodStartDate: body.periodStartDate,
        periodEndDate: body.periodEndDate,
        settlementPeriodId: body.settlementPeriodId,
        transactions: body.transactions,
        createdBy: user.id,
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
      createdBy: user.id,
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
