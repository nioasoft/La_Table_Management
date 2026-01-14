import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { getPeriodByKey } from "@/lib/settlement-periods";
import { getComparisonsByPeriod, generateReconciliationReport } from "@/data-access/crossReferences";
import { getAdjustmentsBySettlementPeriod } from "@/data-access/adjustments";
import {
  getSettlementPeriodByPeriodKey,
  getOrCreateSettlementPeriodByPeriodKey,
  updateSettlementPeriod,
} from "@/data-access/settlements";
import { createAuditContext } from "@/data-access/auditLog";

/**
 * GET /api/settlement-workflow/[periodKey]/approve - Get approval summary for a period
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ periodKey: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { periodKey } = await params;
    const decodedKey = decodeURIComponent(periodKey);

    // Parse period info
    const periodInfo = getPeriodByKey(decodedKey);
    if (!periodInfo) {
      return NextResponse.json(
        { error: "תקופה לא נמצאה", periodKey: decodedKey },
        { status: 404 }
      );
    }

    const periodStartDate = periodInfo.startDate.toISOString().split("T")[0];
    const periodEndDate = periodInfo.endDate.toISOString().split("T")[0];

    // Get settlement period (if exists)
    const settlementPeriod = await getSettlementPeriodByPeriodKey(decodedKey);

    // Get reconciliation data
    const crossReferences = await getComparisonsByPeriod(periodStartDate, periodEndDate);
    const reconciliationReport = await generateReconciliationReport(periodStartDate, periodEndDate);

    // Get adjustments
    const adjustments = settlementPeriod
      ? await getAdjustmentsBySettlementPeriod(settlementPeriod.id)
      : [];

    // Calculate approval readiness
    const openDiscrepancies = crossReferences.filter(
      (cr) => cr.comparisonMetadata?.matchStatus === "discrepancy"
    ).length;
    const pendingAdjustments = adjustments.filter((adj) => !adj.approvedAt).length;

    // Calculate totals
    const totalSupplierAmount = crossReferences.reduce(
      (sum, cr) => sum + parseFloat(cr.comparisonMetadata?.supplierAmount || "0"),
      0
    );
    const totalAdjustmentsAmount = adjustments.reduce(
      (sum, adj) => sum + parseFloat(adj.amount || "0"),
      0
    );

    // Simplified commission calculation (will be expanded in commission calculator)
    // For now, just show the total amounts
    const commissionSummary = {
      totalSupplierAmount,
      totalAdjustments: totalAdjustmentsAmount,
      netAmount: totalSupplierAmount + totalAdjustmentsAmount,
    };

    // Check if ready to approve
    const canApprove = openDiscrepancies === 0 && pendingAdjustments === 0;
    const approvalBlockers: string[] = [];
    if (openDiscrepancies > 0) {
      approvalBlockers.push(`${openDiscrepancies} פערים פתוחים - יש לטפל בהם או להוסיף התאמות`);
    }
    if (pendingAdjustments > 0) {
      approvalBlockers.push(`${pendingAdjustments} התאמות ממתינות לאישור`);
    }

    return NextResponse.json({
      periodKey: decodedKey,
      periodInfo: {
        nameHe: periodInfo.nameHe,
        name: periodInfo.name,
        type: periodInfo.type,
        startDate: periodStartDate,
        endDate: periodEndDate,
      },
      settlementPeriod: settlementPeriod
        ? {
            id: settlementPeriod.id,
            status: settlementPeriod.status,
            approvedAt: settlementPeriod.approvedAt?.toISOString(),
            approvedBy: settlementPeriod.approvedBy,
          }
        : null,
      reconciliation: {
        totalPairs: reconciliationReport?.totalPairs || 0,
        matchedCount: reconciliationReport?.matchedCount || 0,
        discrepancyCount: reconciliationReport?.discrepancyCount || 0,
        pendingCount: reconciliationReport?.pendingCount || 0,
      },
      adjustments: {
        total: adjustments.length,
        approved: adjustments.filter((adj) => adj.approvedAt).length,
        pending: pendingAdjustments,
        totalAmount: totalAdjustmentsAmount,
      },
      commissionSummary,
      approval: {
        canApprove,
        blockers: approvalBlockers,
        isApproved: settlementPeriod?.status === "approved",
      },
    });
  } catch (error) {
    console.error("Error fetching approval summary:", error);
    return NextResponse.json(
      { error: "שגיאה פנימית" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settlement-workflow/[periodKey]/approve - Approve the period
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ periodKey: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { periodKey } = await params;
    const decodedKey = decodeURIComponent(periodKey);

    // Parse period info
    const periodInfo = getPeriodByKey(decodedKey);
    if (!periodInfo) {
      return NextResponse.json(
        { error: "תקופה לא נמצאה", periodKey: decodedKey },
        { status: 404 }
      );
    }

    const periodStartDate = periodInfo.startDate.toISOString().split("T")[0];
    const periodEndDate = periodInfo.endDate.toISOString().split("T")[0];

    // Get or create settlement period
    const result = await getOrCreateSettlementPeriodByPeriodKey(decodedKey, user.id);
    if (!result) {
      return NextResponse.json(
        { error: "לא ניתן ליצור תקופת התחשבנות" },
        { status: 500 }
      );
    }
    const { settlementPeriod } = result;

    // Check if already approved
    if (settlementPeriod.status === "approved" || settlementPeriod.status === "invoiced") {
      return NextResponse.json(
        { error: "התקופה כבר אושרה" },
        { status: 400 }
      );
    }

    // Verify approval readiness
    const crossReferences = await getComparisonsByPeriod(periodStartDate, periodEndDate);
    const adjustments = await getAdjustmentsBySettlementPeriod(settlementPeriod.id);

    const openDiscrepancies = crossReferences.filter(
      (cr) => cr.comparisonMetadata?.matchStatus === "discrepancy"
    ).length;
    const pendingAdjustments = adjustments.filter((adj) => !adj.approvedAt).length;

    if (openDiscrepancies > 0) {
      return NextResponse.json(
        { error: `יש ${openDiscrepancies} פערים פתוחים - יש לטפל בהם לפני אישור` },
        { status: 400 }
      );
    }

    if (pendingAdjustments > 0) {
      return NextResponse.json(
        { error: `יש ${pendingAdjustments} התאמות ממתינות לאישור` },
        { status: 400 }
      );
    }

    // Create audit context
    const auditContext = createAuditContext(
      { user: { id: user.id, name: user.name || user.email, email: user.email } },
      request
    );

    // Update settlement status to approved
    const updatedSettlement = await updateSettlementPeriod(
      settlementPeriod.id,
      {
        status: "approved",
        approvedAt: new Date(),
        approvedBy: user.id,
      },
      auditContext,
      "אישור תקופת התחשבנות"
    );

    if (!updatedSettlement) {
      return NextResponse.json(
        { error: "שגיאה באישור התקופה" },
        { status: 500 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "התקופה אושרה בהצלחה",
      settlementPeriod: {
        id: updatedSettlement.id,
        status: updatedSettlement.status,
        approvedAt: updatedSettlement.approvedAt?.toISOString(),
        approvedBy: updatedSettlement.approvedBy,
      },
    });
  } catch (error) {
    console.error("Error approving period:", error);
    return NextResponse.json(
      { error: "שגיאה באישור התקופה" },
      { status: 500 }
    );
  }
}
