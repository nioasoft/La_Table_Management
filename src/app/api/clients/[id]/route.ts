import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  updateClient,
  deleteClient,
  setClientFranchisees,
} from "@/data-access/clients";

/**
 * PATCH /api/clients/[id] - Update a client
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;
    const body = await request.json();
    const {
      name,
      code,
      companyId,
      email,
      contactName,
      hashavshevetName,
      hashavshevetCode,
      fileFormat,
      gmailSearchQuery,
      gmailSenderEmail,
      tabitColumnNames,
      posTerminalCommission,
      dineInCommission,
      deliveryCommission,
      takeawayCommission,
      eventsCommission,
      additionalBenefits,
      invoiceGeneration,
      notes,
      isActive,
      franchiseeIds,
    } = body;

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (code !== undefined) updateData.code = code || null;
    if (companyId !== undefined) updateData.companyId = companyId || null;
    if (email !== undefined) updateData.email = email || null;
    if (contactName !== undefined) updateData.contactName = contactName || null;
    if (hashavshevetName !== undefined)
      updateData.hashavshevetName = hashavshevetName || null;
    if (hashavshevetCode !== undefined)
      updateData.hashavshevetCode = hashavshevetCode || null;
    if (fileFormat !== undefined) updateData.fileFormat = fileFormat || null;
    if (gmailSearchQuery !== undefined)
      updateData.gmailSearchQuery = gmailSearchQuery || null;
    if (gmailSenderEmail !== undefined)
      updateData.gmailSenderEmail = gmailSenderEmail || null;
    if (tabitColumnNames !== undefined)
      updateData.tabitColumnNames = Array.isArray(tabitColumnNames)
        ? tabitColumnNames
        : null;
    if (posTerminalCommission !== undefined)
      updateData.posTerminalCommission = posTerminalCommission || null;
    if (dineInCommission !== undefined)
      updateData.dineInCommission = dineInCommission || null;
    if (deliveryCommission !== undefined)
      updateData.deliveryCommission = deliveryCommission || null;
    if (takeawayCommission !== undefined)
      updateData.takeawayCommission = takeawayCommission || null;
    if (eventsCommission !== undefined)
      updateData.eventsCommission = eventsCommission || null;
    if (additionalBenefits !== undefined)
      updateData.additionalBenefits = additionalBenefits || null;
    if (invoiceGeneration !== undefined)
      updateData.invoiceGeneration = invoiceGeneration;
    if (notes !== undefined) updateData.notes = notes || null;
    if (isActive !== undefined) updateData.isActive = isActive;

    const updated = await updateClient(id, updateData);

    if (!updated) {
      return NextResponse.json(
        { error: "לקוח לא נמצא" },
        { status: 404 }
      );
    }

    // Update franchisee associations if provided
    if (franchiseeIds !== undefined) {
      await setClientFranchisees(id, franchiseeIds || []);
    }

    return NextResponse.json({ client: updated });
  } catch (error) {
    console.error("Error updating client:", error);
    return NextResponse.json(
      { error: "שגיאה בעדכון לקוח" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/clients/[id] - Delete a client
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;
    const deleted = await deleteClient(id);

    if (!deleted) {
      return NextResponse.json(
        { error: "לקוח לא נמצא" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting client:", error);
    return NextResponse.json(
      { error: "שגיאה במחיקת לקוח" },
      { status: 500 }
    );
  }
}
