import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getContactsByFranchiseeId,
  createContact,
} from "@/data-access/contacts";
import { getFranchiseeById } from "@/data-access/franchisees";
import type { ContactRole } from "@/db/schema";

interface RouteContext {
  params: Promise<{ franchiseeId: string }>;
}

/**
 * GET /api/franchisees/[franchiseeId]/contacts - List contacts for a franchisee
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { franchiseeId } = await context.params;

    const contacts = await getContactsByFranchiseeId(franchiseeId);
    return NextResponse.json({ contacts });
  } catch (error) {
    console.error("Error fetching contacts:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת אנשי קשר" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/franchisees/[franchiseeId]/contacts - Create a new contact
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { franchiseeId } = await context.params;

    // Verify franchisee exists
    const franchisee = await getFranchiseeById(franchiseeId);
    if (!franchisee) {
      return NextResponse.json(
        { error: "זכיין לא נמצא" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { name, phone, email, role, notes, isPrimary, ownershipPercentage } = body;

    if (!name) {
      return NextResponse.json(
        { error: "שם איש קשר הוא שדה חובה" },
        { status: 400 }
      );
    }

    const newContact = await createContact({
      id: crypto.randomUUID(),
      franchiseeId,
      name,
      phone: phone || null,
      email: email || null,
      role: (role as ContactRole) || "other",
      notes: notes || null,
      isPrimary: isPrimary || false,
      ownershipPercentage: role === "owner" && ownershipPercentage != null
        ? String(ownershipPercentage)
        : null,
      isActive: true,
      createdBy: user.id,
    });

    return NextResponse.json({ contact: newContact }, { status: 201 });
  } catch (error) {
    console.error("Error creating contact:", error);
    return NextResponse.json(
      { error: "שגיאה ביצירת איש קשר" },
      { status: 500 }
    );
  }
}
