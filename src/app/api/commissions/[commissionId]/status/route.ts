import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  transitionCommissionStatus,
  approveCommission,
  markCommissionAsPaid,
  cancelCommission,
  getCommissionWithDetailsById,
  getAllowedNextCommissionStatuses,
} from "@/data-access/commissions";
import { type CommissionStatus } from "@/db/schema";
import { createAuditContext } from "@/data-access/auditLog";

interface RouteContext {
  params: Promise<{ commissionId: string }>;
}

/**
 * GET /api/commissions/[commissionId]/status - Get commission status info
 *
 * Returns current status and allowed transitions
 */
export async function GET(request: NextRequest, context: RouteContext) {
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

    const { commissionId } = await context.params;

    const commission = await getCommissionWithDetailsById(commissionId);

    if (!commission) {
      return NextResponse.json(
        { error: "Commission not found" },
        { status: 404 }
      );
    }

    const allowedTransitions = getAllowedNextCommissionStatuses(commission.status as CommissionStatus);

    return NextResponse.json({
      commissionId,
      currentStatus: commission.status,
      allowedTransitions,
      calculatedAt: commission.calculatedAt,
      approvedAt: commission.approvedAt,
      approvedBy: commission.approvedBy,
      paidAt: commission.paidAt,
    });
  } catch (error) {
    console.error("Error fetching commission status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/commissions/[commissionId]/status - Change commission status
 *
 * Request body:
 * {
 *   action: "approve" | "pay" | "cancel" | "transition",
 *   reason?: string (required for cancel),
 *   status?: CommissionStatus (required for transition)
 * }
 *
 * Actions:
 * - "approve": Move from calculated to approved
 * - "pay": Move from approved to paid
 * - "cancel": Cancel the commission (requires reason)
 * - "transition": Generic status transition (requires status)
 */
export async function POST(request: NextRequest, context: RouteContext) {
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

    const { commissionId } = await context.params;
    const body = await request.json();

    const { action, reason, status } = body;

    if (!action) {
      return NextResponse.json(
        { error: "Action is required" },
        { status: 400 }
      );
    }

    const auditContext = createAuditContext(
      { user: { id: session.user.id, name: session.user.name, email: session.user.email } },
      request
    );

    let result;

    switch (action) {
      case "approve":
        result = await approveCommission(commissionId, auditContext);
        break;

      case "pay":
        result = await markCommissionAsPaid(commissionId, auditContext);
        break;

      case "cancel":
        if (!reason) {
          return NextResponse.json(
            { error: "Reason is required for cancellation" },
            { status: 400 }
          );
        }
        result = await cancelCommission(commissionId, reason, auditContext);
        break;

      case "transition":
        if (!status) {
          return NextResponse.json(
            { error: "Status is required for transition action" },
            { status: 400 }
          );
        }
        result = await transitionCommissionStatus(commissionId, status, auditContext, reason);
        break;

      default:
        return NextResponse.json(
          { error: `Invalid action: ${action}. Valid actions are: approve, pay, cancel, transition` },
          { status: 400 }
        );
    }

    if (!result.success) {
      return NextResponse.json(
        { error: result.error },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      commission: result.commission,
      newStatus: result.commission?.status,
    });
  } catch (error) {
    console.error("Error changing commission status:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
