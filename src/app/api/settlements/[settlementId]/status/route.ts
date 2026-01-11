import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getSettlementPeriodById,
  transitionSettlementStatus,
  startProcessing,
  submitForApproval,
  approveSettlementWithValidation,
  markAsInvoiced,
  cancelSettlementPeriod,
  reopenSettlementPeriod,
  getAllowedNextStatuses,
  isValidStatusTransition,
  SETTLEMENT_STATUS_TRANSITIONS,
} from "@/data-access/settlements";
import { createAuditContext } from "@/data-access/auditLog";
import type { SettlementStatus } from "@/db/schema";

// Valid statuses
const VALID_STATUSES: SettlementStatus[] = [
  "open", "processing", "pending_approval", "approved", "invoiced",
  "draft", "pending", "completed", "cancelled"
];

/**
 * GET /api/settlements/[settlementId]/status - Get current status and allowed transitions
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
    const settlement = await getSettlementPeriodById(settlementId);

    if (!settlement) {
      return NextResponse.json(
        { error: "Settlement period not found" },
        { status: 404 }
      );
    }

    const currentStatus = settlement.status;
    const allowedTransitions = getAllowedNextStatuses(currentStatus);

    return NextResponse.json({
      settlementId,
      currentStatus,
      allowedTransitions,
      allTransitions: SETTLEMENT_STATUS_TRANSITIONS,
    });
  } catch (error) {
    console.error("Error fetching settlement status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settlements/[settlementId]/status - Transition to a new status
 * Body:
 * - status: Required - The new status
 * - reason: Optional - Reason for the transition
 * - action: Optional - Shortcut action (start_processing, submit_for_approval, approve, invoice, cancel, reopen)
 */
export async function POST(
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

    const { settlementId } = await params;
    const body = await request.json();
    const { status, action, reason } = body;

    // Check settlement exists
    const settlement = await getSettlementPeriodById(settlementId);
    if (!settlement) {
      return NextResponse.json(
        { error: "Settlement period not found" },
        { status: 404 }
      );
    }

    // Create audit context
    const auditContext = createAuditContext(session, request);

    let result;

    // Handle action shortcuts
    if (action) {
      // Most actions require admin or super_user
      if (userRole !== "super_user" && userRole !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      switch (action) {
        case "start_processing":
          result = await startProcessing(settlementId, auditContext);
          break;
        case "submit_for_approval":
          result = await submitForApproval(settlementId, auditContext);
          break;
        case "approve":
          // Approval might require special permissions
          if (userRole !== "super_user") {
            return NextResponse.json(
              { error: "Only super_user can approve settlements" },
              { status: 403 }
            );
          }
          result = await approveSettlementWithValidation(
            settlementId,
            session.user.id,
            auditContext
          );
          break;
        case "invoice":
          result = await markAsInvoiced(settlementId, auditContext);
          break;
        case "cancel":
          if (!reason) {
            return NextResponse.json(
              { error: "Reason is required for cancellation" },
              { status: 400 }
            );
          }
          result = await cancelSettlementPeriod(settlementId, reason, auditContext);
          break;
        case "reopen":
          if (!reason) {
            return NextResponse.json(
              { error: "Reason is required for reopening" },
              { status: 400 }
            );
          }
          result = await reopenSettlementPeriod(settlementId, reason, auditContext);
          break;
        default:
          return NextResponse.json(
            { error: `Unknown action: ${action}. Valid actions: start_processing, submit_for_approval, approve, invoice, cancel, reopen` },
            { status: 400 }
          );
      }
    } else if (status) {
      // Direct status transition
      if (userRole !== "super_user" && userRole !== "admin") {
        return NextResponse.json({ error: "Forbidden" }, { status: 403 });
      }

      // Validate status
      if (!VALID_STATUSES.includes(status)) {
        return NextResponse.json(
          { error: `Invalid status. Must be one of: ${VALID_STATUSES.join(", ")}` },
          { status: 400 }
        );
      }

      // Check if transition is valid
      if (!isValidStatusTransition(settlement.status, status)) {
        const allowed = getAllowedNextStatuses(settlement.status);
        return NextResponse.json(
          {
            error: `Invalid status transition from '${settlement.status}' to '${status}'`,
            allowedTransitions: allowed,
          },
          { status: 400 }
        );
      }

      // Special handling for approve status
      if (status === "approved") {
        if (userRole !== "super_user") {
          return NextResponse.json(
            { error: "Only super_user can approve settlements" },
            { status: 403 }
          );
        }
        result = await approveSettlementWithValidation(
          settlementId,
          session.user.id,
          auditContext
        );
      } else {
        result = await transitionSettlementStatus(
          settlementId,
          status,
          auditContext,
          reason
        );
      }
    } else {
      return NextResponse.json(
        { error: "Either 'status' or 'action' is required" },
        { status: 400 }
      );
    }

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    // Get new allowed transitions
    const newAllowedTransitions = result.settlement
      ? getAllowedNextStatuses(result.settlement.status)
      : [];

    return NextResponse.json({
      settlement: result.settlement,
      previousStatus: settlement.status,
      newStatus: result.settlement?.status,
      allowedTransitions: newAllowedTransitions,
    });
  } catch (error) {
    console.error("Error transitioning settlement status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
