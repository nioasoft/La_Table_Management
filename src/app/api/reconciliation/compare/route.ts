import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  compareAmounts,
  createComparisonCrossReference,
  DEFAULT_MATCH_THRESHOLD,
} from "@/data-access/crossReferences";

/**
 * POST /api/reconciliation/compare - Compare supplier vs franchisee amounts
 * Body:
 * - supplierId: Required - Supplier ID
 * - franchiseeId: Required - Franchisee ID
 * - supplierAmount: Required - Supplier reported amount
 * - franchiseeAmount: Required - Franchisee reported amount
 * - periodStartDate: Required - Period start date
 * - periodEndDate: Required - Period end date
 * - threshold: Optional - Custom matching threshold (default ₪10)
 * - commissionId: Optional - Related commission ID
 * - createCrossRef: Optional - Whether to create a cross-reference record (default true)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin or super_user
    const userRole = (session.user as typeof session.user & { role?: string }).role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const {
      supplierId,
      franchiseeId,
      supplierAmount,
      franchiseeAmount,
      periodStartDate,
      periodEndDate,
      threshold,
      commissionId,
      createCrossRef = true,
    } = body;

    // Validate required fields
    if (!supplierId) {
      return NextResponse.json(
        { error: "supplierId is required" },
        { status: 400 }
      );
    }

    if (!franchiseeId) {
      return NextResponse.json(
        { error: "franchiseeId is required" },
        { status: 400 }
      );
    }

    if (supplierAmount === undefined || supplierAmount === null) {
      return NextResponse.json(
        { error: "supplierAmount is required" },
        { status: 400 }
      );
    }

    if (franchiseeAmount === undefined || franchiseeAmount === null) {
      return NextResponse.json(
        { error: "franchiseeAmount is required" },
        { status: 400 }
      );
    }

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

    // Perform the comparison
    const matchThreshold = threshold || DEFAULT_MATCH_THRESHOLD;
    const comparisonResult = compareAmounts(
      parseFloat(supplierAmount),
      parseFloat(franchiseeAmount),
      matchThreshold
    );

    let crossReference = null;

    // Create cross-reference if requested
    if (createCrossRef) {
      crossReference = await createComparisonCrossReference(
        supplierId,
        franchiseeId,
        parseFloat(supplierAmount),
        parseFloat(franchiseeAmount),
        periodStartDate,
        periodEndDate,
        matchThreshold,
        commissionId,
        session.user.id
      );
    }

    return NextResponse.json(
      {
        comparison: {
          supplierAmount: comparisonResult.supplierAmount,
          franchiseeAmount: comparisonResult.franchiseeAmount,
          difference: comparisonResult.difference,
          absoluteDifference: comparisonResult.absoluteDifference,
          differencePercentage: comparisonResult.differencePercentage,
          matchStatus: comparisonResult.matchStatus,
          threshold: comparisonResult.threshold,
        },
        crossReference,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error comparing amounts:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
