import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getCrossReferenceById,
  updateCrossReference,
  updateMatchStatus,
  updateFranchiseeAmount,
  deleteCrossReference,
  type CrossReferenceComparisonMetadata,
  DEFAULT_MATCH_THRESHOLD,
} from "@/data-access/crossReferences";

/**
 * GET /api/reconciliation/[crossRefId] - Get a single cross-reference
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ crossRefId: string }> }
) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user has permission
    const userRole = (session.user as typeof session.user & { role?: string }).role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { crossRefId } = await params;
    const crossRef = await getCrossReferenceById(crossRefId);

    if (!crossRef) {
      return NextResponse.json(
        { error: "Cross-reference not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ crossReference: crossRef });
  } catch (error) {
    console.error("Error fetching cross-reference:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/reconciliation/[crossRefId] - Update a cross-reference
 * Body:
 * - matchStatus: Optional - Update match status (matched/discrepancy)
 * - reviewNotes: Optional - Add review notes
 * - franchiseeAmount: Optional - Update franchisee reported amount
 * - threshold: Optional - Custom threshold for recalculation
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ crossRefId: string }> }
) {
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

    const { crossRefId } = await params;
    const body = await request.json();
    const { matchStatus, reviewNotes, franchiseeAmount, threshold } = body;

    // Check if cross-reference exists
    const existing = await getCrossReferenceById(crossRefId);
    if (!existing) {
      return NextResponse.json(
        { error: "Cross-reference not found" },
        { status: 404 }
      );
    }

    let updated;

    // If franchisee amount is provided, update and recalculate
    if (franchiseeAmount !== undefined) {
      updated = await updateFranchiseeAmount(
        crossRefId,
        parseFloat(franchiseeAmount),
        threshold || DEFAULT_MATCH_THRESHOLD
      );
    }
    // If match status is provided, update it manually
    else if (matchStatus) {
      if (!["matched", "discrepancy", "pending"].includes(matchStatus)) {
        return NextResponse.json(
          { error: "Invalid matchStatus. Must be 'matched', 'discrepancy', or 'pending'" },
          { status: 400 }
        );
      }
      updated = await updateMatchStatus(
        crossRefId,
        matchStatus,
        session.user.id,
        reviewNotes
      );
    }
    // Just update review notes
    else if (reviewNotes) {
      const currentMetadata = (existing.metadata as CrossReferenceComparisonMetadata) || {};
      updated = await updateCrossReference(crossRefId, {
        metadata: {
          ...currentMetadata,
          reviewNotes,
          reviewedBy: session.user.id,
          reviewedAt: new Date().toISOString(),
        },
      });
    } else {
      return NextResponse.json(
        { error: "No valid update fields provided" },
        { status: 400 }
      );
    }

    if (!updated) {
      return NextResponse.json(
        { error: "Failed to update cross-reference" },
        { status: 500 }
      );
    }

    return NextResponse.json({ crossReference: updated });
  } catch (error) {
    console.error("Error updating cross-reference:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/reconciliation/[crossRefId] - Delete a cross-reference
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ crossRefId: string }> }
) {
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

    const { crossRefId } = await params;
    const deleted = await deleteCrossReference(crossRefId);

    if (!deleted) {
      return NextResponse.json(
        { error: "Cross-reference not found or already deleted" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting cross-reference:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
