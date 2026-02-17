import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getStaffContacts, createStaffContact } from "@/data-access/staff-contacts";
import { staffRoleEnum } from "@/db/schema";
import { randomUUID } from "crypto";

const validRoles = staffRoleEnum.enumValues;

/**
 * GET /api/staff-contacts - List staff contacts with optional filters
 *
 * Query params:
 * - brandId: filter by brand (use "group" for group-level / null brandId)
 * - role: filter by staff role
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;
    const brandIdParam = searchParams.get("brandId");
    const roleParam = searchParams.get("role");

    const options: {
      brandId?: string | null;
      role?: (typeof validRoles)[number];
      isActive?: boolean;
    } = {};

    if (brandIdParam === "group") {
      options.brandId = null;
    } else if (brandIdParam) {
      options.brandId = brandIdParam;
    }

    if (roleParam && validRoles.includes(roleParam as (typeof validRoles)[number])) {
      options.role = roleParam as (typeof validRoles)[number];
    }

    const staffContacts = await getStaffContacts(options);

    return NextResponse.json({ staffContacts });
  } catch (error) {
    console.error("Error fetching staff contacts:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת אנשי מטה" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/staff-contacts - Create a new staff contact
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const { name, phone, email, role, brandId } = body;

    if (!name || !role) {
      return NextResponse.json(
        { error: "שם ותפקיד הם שדות חובה" },
        { status: 400 }
      );
    }

    if (!validRoles.includes(role)) {
      return NextResponse.json(
        { error: "תפקיד לא תקין" },
        { status: 400 }
      );
    }

    const newContact = await createStaffContact({
      id: randomUUID(),
      name,
      phone: phone || null,
      email: email || null,
      role,
      brandId: brandId || null,
      createdBy: user.id,
    });

    return NextResponse.json({ staffContact: newContact }, { status: 201 });
  } catch (error) {
    console.error("Error creating staff contact:", error);
    return NextResponse.json(
      { error: "שגיאה ביצירת איש מטה" },
      { status: 500 }
    );
  }
}
