import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getSettlementPeriodById,
  getSettlementPeriodWithDetails,
  updateSettlementPeriod,
  deleteSettlementPeriod,
  getAllowedNextStatuses,
} from "@/data-access/settlements";
import { createAuditContext } from "@/data-access/auditLog";
import type { SettlementPeriodType } from "@/db/schema";

// Valid period types
const VALID_PERIOD_TYPES: SettlementPeriodType[] = ["monthly", "quarterly", "semi_annual", "annual"];

/**
 * GET /api/settlements/[settlementId] - Get a single settlement period
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ settlementId: string }> }
) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string }).role;
    if (userRole !== "super_user" && userRole !== "admin" && userRole !== "franchisee_owner") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { settlementId } = await params;
    const searchParams = request.nextUrl.searchParams;
    const includeDetails = searchParams.get("details") === "true";

    let settlement;
    if (includeDetails) {
      settlement = await getSettlementPeriodWithDetails(settlementId);
    } else {
      settlement = await getSettlementPeriodById(settlementId);
    }

    if (!settlement) {
      return NextResponse.json(
        { error: "Settlement period not found" },
        { status: 404 }
      );
    }

    // Include allowed transitions for the current status
    const allowedTransitions = getAllowedNextStatuses(settlement.status);

    return NextResponse.json({
      settlement,
      allowedTransitions,
    });
  } catch (error) {
    console.error("Error fetching settlement:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/settlements/[settlementId] - Update a settlement period
 * Note: For status transitions, use the dedicated /status route
 * IMPORTANT: Approved and invoiced settlements are locked and cannot be edited
 * (except by super_user who can still update notes/metadata)
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ settlementId: string }> }
) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string }).role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { settlementId } = await params;
    const body = await request.json();

    // Check if settlement exists and its current status
    const existingSettlement = await getSettlementPeriodById(settlementId);
    if (!existingSettlement) {
      return NextResponse.json(
        { error: "Settlement period not found" },
        { status: 404 }
      );
    }

    // LOCKING MECHANISM: Approved and invoiced settlements are locked
    // Only super_user can update notes/metadata on locked settlements
    const isLocked = existingSettlement.status === "approved" || existingSettlement.status === "invoiced";

    if (isLocked) {
      // Define which fields can still be updated on locked settlements (by super_user only)
      const allowedLockedFields = ["notes", "metadata", "reason"];
      const attemptedFields = Object.keys(body);
      const disallowedFields = attemptedFields.filter(f => !allowedLockedFields.includes(f));

      if (disallowedFields.length > 0) {
        if (userRole !== "super_user") {
          return NextResponse.json(
            {
              error: `Settlement is ${existingSettlement.status} and locked. Only super_user can modify notes/metadata.`,
              isLocked: true,
              status: existingSettlement.status,
              approvedAt: existingSettlement.approvedAt,
              approvedBy: existingSettlement.approvedBy,
            },
            { status: 403 }
          );
        }
        // Super user attempting to change locked financial fields
        return NextResponse.json(
          {
            error: `Settlement is ${existingSettlement.status} and locked. Cannot modify: ${disallowedFields.join(", ")}. To make changes, reopen the settlement first.`,
            isLocked: true,
            status: existingSettlement.status,
            approvedAt: existingSettlement.approvedAt,
            approvedBy: existingSettlement.approvedBy,
          },
          { status: 400 }
        );
      }

      // Even for allowed fields, only super_user can update locked settlements
      if (userRole !== "super_user") {
        return NextResponse.json(
          {
            error: `Settlement is ${existingSettlement.status} and locked. Only super_user can modify locked settlements.`,
            isLocked: true,
            status: existingSettlement.status,
          },
          { status: 403 }
        );
      }
    }

    // Validate period type if provided
    if (body.periodType && !VALID_PERIOD_TYPES.includes(body.periodType)) {
      return NextResponse.json(
        { error: `Invalid periodType. Must be one of: ${VALID_PERIOD_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    // Create audit context
    const auditContext = createAuditContext(session, request);

    // Extract reason if provided (for status changes)
    const { reason, ...updateData } = body;

    const updatedSettlement = await updateSettlementPeriod(
      settlementId,
      updateData,
      auditContext,
      reason
    );

    if (!updatedSettlement) {
      return NextResponse.json(
        { error: "Failed to update settlement period" },
        { status: 500 }
      );
    }

    // Include allowed transitions for the updated status
    const allowedTransitions = getAllowedNextStatuses(updatedSettlement.status);

    return NextResponse.json({
      settlement: updatedSettlement,
      allowedTransitions,
      isLocked: updatedSettlement.status === "approved" || updatedSettlement.status === "invoiced",
    });
  } catch (error) {
    console.error("Error updating settlement:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/settlements/[settlementId] - Delete a settlement period
 * Only super_user can delete settlement periods
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ settlementId: string }> }
) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only super_user can delete
    const userRole = (session.user as typeof session.user & { role?: string }).role;
    if (userRole !== "super_user") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { settlementId } = await params;

    // Check if settlement exists first
    const settlement = await getSettlementPeriodById(settlementId);
    if (!settlement) {
      return NextResponse.json(
        { error: "Settlement period not found" },
        { status: 404 }
      );
    }

    // Don't allow deleting invoiced settlements
    if (settlement.status === "invoiced") {
      return NextResponse.json(
        { error: "Cannot delete an invoiced settlement period" },
        { status: 400 }
      );
    }

    const deleted = await deleteSettlementPeriod(settlementId);

    if (!deleted) {
      return NextResponse.json(
        { error: "Failed to delete settlement period" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting settlement:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
