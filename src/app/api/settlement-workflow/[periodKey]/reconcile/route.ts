import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import {
  performBulkComparison,
  generateReconciliationReport,
  getComparisonsByPeriod,
  updateFranchiseeAmount,
  updateMatchStatus,
  DEFAULT_MATCH_THRESHOLD,
  type CrossReferenceMatchStatus,
} from "@/data-access/crossReferences";
import { getPeriodByKey } from "@/lib/settlement-periods";

/**
 * GET /api/settlement-workflow/[periodKey]/reconcile - Get reconciliation data for a period
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

    // Get existing cross-references
    const crossReferences = await getComparisonsByPeriod(
      periodStartDate,
      periodEndDate
    );

    // Generate report
    const report = await generateReconciliationReport(
      periodStartDate,
      periodEndDate
    );

    return NextResponse.json({
      periodKey: decodedKey,
      periodInfo: {
        nameHe: periodInfo.nameHe,
        name: periodInfo.name,
        type: periodInfo.type,
        startDate: periodStartDate,
        endDate: periodEndDate,
      },
      crossReferences: crossReferences.map((cr) => ({
        id: cr.id,
        supplierId: cr.sourceId,
        supplierName: cr.supplierInfo?.name || cr.comparisonMetadata?.supplierName,
        supplierCode: cr.supplierInfo?.code,
        franchiseeId: cr.targetId,
        franchiseeName: cr.franchiseeInfo?.name || cr.comparisonMetadata?.franchiseeName,
        franchiseeCode: cr.franchiseeInfo?.code,
        supplierAmount: parseFloat(cr.comparisonMetadata?.supplierAmount || "0"),
        franchiseeAmount: parseFloat(cr.comparisonMetadata?.franchiseeAmount || "0"),
        difference: parseFloat(cr.comparisonMetadata?.difference || "0"),
        differencePercentage: cr.comparisonMetadata?.differencePercentage || 0,
        matchStatus: cr.comparisonMetadata?.matchStatus || "pending",
        autoMatched: cr.comparisonMetadata?.autoMatched,
        manualReview: cr.comparisonMetadata?.manualReview,
        reviewedBy: cr.comparisonMetadata?.reviewedBy,
        reviewedAt: cr.comparisonMetadata?.reviewedAt,
        reviewNotes: cr.comparisonMetadata?.reviewNotes,
        createdAt: cr.createdAt,
      })),
      report,
    });
  } catch (error) {
    console.error("Error fetching reconciliation data:", error);
    return NextResponse.json(
      { error: "שגיאה פנימית" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settlement-workflow/[periodKey]/reconcile - Run reconciliation for a period
 *
 * Body:
 * - threshold: Optional matching threshold (default: 10)
 * - forceRerun: Force re-run even if cross-references exist
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

    // Parse request body
    const body = await request.json().catch(() => ({}));
    const threshold = body.threshold || DEFAULT_MATCH_THRESHOLD;

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

    // Run bulk comparison
    const results = await performBulkComparison(
      periodStartDate,
      periodEndDate,
      threshold,
      user.id
    );

    // Generate report after comparison
    const report = await generateReconciliationReport(
      periodStartDate,
      periodEndDate
    );

    return NextResponse.json({
      success: true,
      message: `נוצרו ${results.created} השוואות`,
      periodKey: decodedKey,
      results: {
        created: results.created,
        matched: results.matched,
        discrepancies: results.discrepancies,
        threshold,
      },
      report,
    });
  } catch (error) {
    console.error("Error running reconciliation:", error);
    return NextResponse.json(
      { error: "שגיאה בהרצת ההצלבה" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/settlement-workflow/[periodKey]/reconcile - Update a cross-reference
 *
 * Body:
 * - crossReferenceId: Required - ID of the cross-reference to update
 * - action: "updateStatus" | "updateFranchiseeAmount"
 * - For updateStatus:
 *   - status: "matched" | "discrepancy" | "pending"
 *   - reviewNotes: Optional notes
 * - For updateFranchiseeAmount:
 *   - franchiseeAmount: New amount
 *   - threshold: Optional matching threshold
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ periodKey: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const { crossReferenceId, action, status, reviewNotes, franchiseeAmount, threshold } = body;

    if (!crossReferenceId) {
      return NextResponse.json(
        { error: "crossReferenceId is required" },
        { status: 400 }
      );
    }

    if (!action) {
      return NextResponse.json(
        { error: "action is required" },
        { status: 400 }
      );
    }

    let updatedCrossRef;

    if (action === "updateStatus") {
      if (!status || !["matched", "discrepancy", "pending"].includes(status)) {
        return NextResponse.json(
          { error: "Valid status is required (matched, discrepancy, pending)" },
          { status: 400 }
        );
      }

      updatedCrossRef = await updateMatchStatus(
        crossReferenceId,
        status as CrossReferenceMatchStatus,
        user.id,
        reviewNotes
      );
    } else if (action === "updateFranchiseeAmount") {
      if (typeof franchiseeAmount !== "number") {
        return NextResponse.json(
          { error: "franchiseeAmount (number) is required" },
          { status: 400 }
        );
      }

      updatedCrossRef = await updateFranchiseeAmount(
        crossReferenceId,
        franchiseeAmount,
        threshold || DEFAULT_MATCH_THRESHOLD
      );
    } else {
      return NextResponse.json(
        { error: "Invalid action. Use 'updateStatus' or 'updateFranchiseeAmount'" },
        { status: 400 }
      );
    }

    if (!updatedCrossRef) {
      return NextResponse.json(
        { error: "Cross-reference not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      crossReference: updatedCrossRef,
    });
  } catch (error) {
    console.error("Error updating cross-reference:", error);
    return NextResponse.json(
      { error: "שגיאה בעדכון ההשוואה" },
      { status: 500 }
    );
  }
}
