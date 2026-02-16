import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getContactById,
  updateContact,
  deleteContact,
} from "@/data-access/contacts";

interface RouteContext {
  params: Promise<{ franchiseeId: string; contactId: string }>;
}

/**
 * PATCH /api/franchisees/[franchiseeId]/contacts/[contactId] - Update a contact
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { contactId } = await context.params;

    const existing = await getContactById(contactId);
    if (!existing) {
      return NextResponse.json(
        { error: "איש קשר לא נמצא" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { name, phone, email, role, notes, isPrimary, ownershipPercentage } = body;

    const updated = await updateContact(contactId, {
      ...(name !== undefined && { name }),
      ...(phone !== undefined && { phone: phone || null }),
      ...(email !== undefined && { email: email || null }),
      ...(role !== undefined && { role }),
      ...(notes !== undefined && { notes: notes || null }),
      ...(isPrimary !== undefined && { isPrimary }),
      ...(ownershipPercentage !== undefined && {
        ownershipPercentage: role === "owner" && ownershipPercentage != null
          ? String(ownershipPercentage)
          : null,
      }),
    });

    return NextResponse.json({ contact: updated });
  } catch (error) {
    console.error("Error updating contact:", error);
    return NextResponse.json(
      { error: "שגיאה בעדכון איש קשר" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/franchisees/[franchiseeId]/contacts/[contactId] - Delete a contact
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { contactId } = await context.params;

    const existing = await getContactById(contactId);
    if (!existing) {
      return NextResponse.json(
        { error: "איש קשר לא נמצא" },
        { status: 404 }
      );
    }

    await deleteContact(contactId);

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting contact:", error);
    return NextResponse.json(
      { error: "שגיאה במחיקת איש קשר" },
      { status: 500 }
    );
  }
}
