import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getAllBlacklisted,
  addToBlacklist,
  removeFromBlacklist,
  isBlacklisted,
} from "@/data-access/supplier-file-blacklist";

/**
 * GET /api/supplier-files/blacklist - Get all blacklisted names
 * Query params: supplierId (optional) - filter by supplier
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const supplierId = searchParams.get("supplierId") || undefined;

    const blacklist = await getAllBlacklisted(supplierId);

    return NextResponse.json({
      items: blacklist,
      total: blacklist.length,
    });
  } catch (error) {
    console.error("Error fetching supplier file blacklist:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/supplier-files/blacklist - Add a name to the blacklist
 * Body: { name: string, notes?: string, supplierId?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const { name, notes, supplierId } = body;

    if (!name || typeof name !== "string") {
      return NextResponse.json(
        { error: "שם הוא שדה חובה" },
        { status: 400 }
      );
    }

    const trimmedName = name.trim();
    if (trimmedName.length === 0) {
      return NextResponse.json(
        { error: "השם לא יכול להיות ריק" },
        { status: 400 }
      );
    }

    // Check if already blacklisted
    const alreadyBlacklisted = await isBlacklisted(trimmedName, supplierId);
    if (alreadyBlacklisted) {
      return NextResponse.json(
        { error: "השם כבר נמצא ברשימה השחורה" },
        { status: 409 }
      );
    }

    // Add to blacklist
    const entry = await addToBlacklist(
      trimmedName,
      user.id,
      notes || undefined,
      supplierId || undefined
    );

    return NextResponse.json({
      success: true,
      entry,
      message: "השם נוסף לרשימה השחורה בהצלחה",
    });
  } catch (error) {
    console.error("Error adding to supplier file blacklist:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/supplier-files/blacklist - Remove a name from the blacklist
 * Query params: id (required)
 */
export async function DELETE(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const id = searchParams.get("id");

    if (!id) {
      return NextResponse.json(
        { error: "מזהה הרשומה הוא שדה חובה" },
        { status: 400 }
      );
    }

    const removed = await removeFromBlacklist(id);

    if (!removed) {
      return NextResponse.json(
        { error: "הרשומה לא נמצאה" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "השם הוסר מהרשימה השחורה בהצלחה",
    });
  } catch (error) {
    console.error("Error removing from supplier file blacklist:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
