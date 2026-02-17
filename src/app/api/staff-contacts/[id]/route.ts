import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  updateStaffContact,
  deleteStaffContact,
} from "@/data-access/staff-contacts";
import { staffRoleEnum } from "@/db/schema";

const validRoles = staffRoleEnum.enumValues;

/**
 * PATCH /api/staff-contacts/[id] - Update a staff contact
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
    const { name, phone, email, role, brandId, isActive } = body;

    if (role && !validRoles.includes(role)) {
      return NextResponse.json(
        { error: "תפקיד לא תקין" },
        { status: 400 }
      );
    }

    const updateData: Record<string, unknown> = {};
    if (name !== undefined) updateData.name = name;
    if (phone !== undefined) updateData.phone = phone || null;
    if (email !== undefined) updateData.email = email || null;
    if (role !== undefined) updateData.role = role;
    if (brandId !== undefined) updateData.brandId = brandId || null;
    if (isActive !== undefined) updateData.isActive = isActive;

    const updated = await updateStaffContact(id, updateData);

    if (!updated) {
      return NextResponse.json(
        { error: "איש מטה לא נמצא" },
        { status: 404 }
      );
    }

    return NextResponse.json({ staffContact: updated });
  } catch (error) {
    console.error("Error updating staff contact:", error);
    return NextResponse.json(
      { error: "שגיאה בעדכון איש מטה" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/staff-contacts/[id] - Delete a staff contact
 */
export async function DELETE(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { id } = await params;
    const deleted = await deleteStaffContact(id);

    if (!deleted) {
      return NextResponse.json(
        { error: "איש מטה לא נמצא" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting staff contact:", error);
    return NextResponse.json(
      { error: "שגיאה במחיקת איש מטה" },
      { status: 500 }
    );
  }
}
