import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  bulkApproveCommissions,
  bulkMarkCommissionsAsPaid,
  bulkSetCommissionInvoiceInfo,
} from "@/data-access/commissions";
import { createAuditContext } from "@/data-access/auditLog";

/**
 * POST /api/commissions/bulk - Perform bulk operations on commissions
 *
 * Request body:
 * {
 *   action: "approve" | "pay" | "setInvoice",
 *   ids: string[], // Commission IDs
 *   invoiceNumber?: string, // Required for setInvoice
 *   invoiceDate?: string // Required for setInvoice
 * }
 *
 * Actions:
 * - "approve": Bulk approve calculated commissions
 * - "pay": Bulk mark approved commissions as paid
 * - "setInvoice": Set invoice info on approved/paid commissions
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
    const { action, ids, invoiceNumber, invoiceDate } = body;

    if (!action) {
      return NextResponse.json(
        { error: "Action is required" },
        { status: 400 }
      );
    }

    if (!ids || !Array.isArray(ids) || ids.length === 0) {
      return NextResponse.json(
        { error: "IDs array is required and must not be empty" },
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
        result = await bulkApproveCommissions(ids, auditContext);
        return NextResponse.json({
          success: result.success,
          approved: result.approved,
          failed: result.failed,
          totalApproved: result.approved.length,
          totalFailed: result.failed.length,
        });

      case "pay":
        result = await bulkMarkCommissionsAsPaid(ids, auditContext);
        return NextResponse.json({
          success: result.success,
          paid: result.paid,
          failed: result.failed,
          totalPaid: result.paid.length,
          totalFailed: result.failed.length,
        });

      case "setInvoice":
        if (!invoiceNumber || !invoiceDate) {
          return NextResponse.json(
            { error: "invoiceNumber and invoiceDate are required for setInvoice action" },
            { status: 400 }
          );
        }
        result = await bulkSetCommissionInvoiceInfo(ids, invoiceNumber, invoiceDate, auditContext);
        return NextResponse.json({
          success: result.success,
          updated: result.updated,
          failed: result.failed,
          totalUpdated: result.updated.length,
          totalFailed: result.failed.length,
        });

      default:
        return NextResponse.json(
          { error: `Invalid action: ${action}. Valid actions are: approve, pay, setInvoice` },
          { status: 400 }
        );
    }
  } catch (error) {
    console.error("Error performing bulk commission operation:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
