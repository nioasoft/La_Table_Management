import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getCommissionWithDetailsById,
  updateCommission,
  deleteCommission,
} from "@/data-access/commissions";
import { type UpdateCommissionData } from "@/db/schema";
import { createAuditContext, logAuditEvent } from "@/data-access/auditLog";

interface RouteContext {
  params: Promise<{ commissionId: string }>;
}

/**
 * GET /api/commissions/[commissionId] - Get a single commission by ID
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

    return NextResponse.json({ commission });
  } catch (error) {
    console.error("Error fetching commission:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/commissions/[commissionId] - Update a commission
 *
 * Request body:
 * {
 *   notes?: string,
 *   metadata?: object,
 *   invoiceNumber?: string,
 *   invoiceDate?: string
 * }
 *
 * Note: Status changes should be done via the /status endpoint
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
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

    // Get existing commission
    const existingCommission = await getCommissionWithDetailsById(commissionId);

    if (!existingCommission) {
      return NextResponse.json(
        { error: "Commission not found" },
        { status: 404 }
      );
    }

    // Only allow updating certain fields
    const updateData: UpdateCommissionData = {};
    if (body.notes !== undefined) updateData.notes = body.notes;
    if (body.metadata !== undefined) updateData.metadata = body.metadata;
    if (body.invoiceNumber !== undefined) updateData.invoiceNumber = body.invoiceNumber;
    if (body.invoiceDate !== undefined) updateData.invoiceDate = body.invoiceDate;

    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const updatedCommission = await updateCommission(commissionId, updateData);

    if (!updatedCommission) {
      return NextResponse.json(
        { error: "Failed to update commission" },
        { status: 500 }
      );
    }

    // Log the update
    const auditContext = createAuditContext(
      { user: { id: session.user.id, name: session.user.name, email: session.user.email } },
      request
    );

    await logAuditEvent(auditContext, "update", "commission", commissionId, {
      entityName: `${existingCommission.supplierName} - ${existingCommission.franchiseeName}`,
      beforeValue: {
        notes: existingCommission.notes,
        invoiceNumber: existingCommission.invoiceNumber,
        invoiceDate: existingCommission.invoiceDate,
      },
      afterValue: updateData,
    });

    return NextResponse.json({
      success: true,
      commission: updatedCommission,
    });
  } catch (error) {
    console.error("Error updating commission:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/commissions/[commissionId] - Delete a commission
 *
 * Only commissions with status "pending" or "calculated" can be deleted.
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;

    if (userRole !== "super_user") {
      return NextResponse.json(
        { error: "Only super users can delete commissions" },
        { status: 403 }
      );
    }

    const { commissionId } = await context.params;

    // Get existing commission
    const existingCommission = await getCommissionWithDetailsById(commissionId);

    if (!existingCommission) {
      return NextResponse.json(
        { error: "Commission not found" },
        { status: 404 }
      );
    }

    // Only allow deleting pending or calculated commissions
    if (existingCommission.status !== "pending" && existingCommission.status !== "calculated") {
      return NextResponse.json(
        { error: "Only pending or calculated commissions can be deleted" },
        { status: 400 }
      );
    }

    const deleted = await deleteCommission(commissionId);

    if (!deleted) {
      return NextResponse.json(
        { error: "Failed to delete commission" },
        { status: 500 }
      );
    }

    // Log the deletion
    const auditContext = createAuditContext(
      { user: { id: session.user.id, name: session.user.name, email: session.user.email } },
      request
    );

    await logAuditEvent(auditContext, "delete", "commission", commissionId, {
      entityName: `${existingCommission.supplierName} - ${existingCommission.franchiseeName}`,
      beforeValue: {
        grossAmount: existingCommission.grossAmount,
        netAmount: existingCommission.netAmount,
        commissionAmount: existingCommission.commissionAmount,
        status: existingCommission.status,
      },
      afterValue: null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting commission:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
