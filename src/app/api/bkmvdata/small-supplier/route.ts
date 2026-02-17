import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getAllSmallSuppliers,
  addSmallSupplier,
  removeSmallSupplier,
  isSmallSupplier,
} from "@/data-access/bkmvSmallSuppliers";

/**
 * GET /api/bkmvdata/small-supplier - Get all small supplier entries
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const items = await getAllSmallSuppliers();

    return NextResponse.json({
      items,
      total: items.length,
    });
  } catch (error) {
    console.error("Error fetching small suppliers:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/bkmvdata/small-supplier - Add a name as small supplier
 * Body: { name: string, notes?: string }
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const { name, notes } = body;

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

    // Check if already exists
    const alreadyExists = await isSmallSupplier(trimmedName);
    if (alreadyExists) {
      return NextResponse.json(
        { error: "השם כבר מסומן כספק קטן" },
        { status: 409 }
      );
    }

    const entry = await addSmallSupplier(trimmedName, user.id, notes);

    return NextResponse.json({
      success: true,
      entry,
      message: "השם נוסף כספק קטן בהצלחה",
    });
  } catch (error) {
    console.error("Error adding small supplier:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/bkmvdata/small-supplier - Remove a small supplier entry
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

    const removed = await removeSmallSupplier(id);

    if (!removed) {
      return NextResponse.json(
        { error: "הרשומה לא נמצאה" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      message: "השם הוסר מרשימת הספקים הקטנים בהצלחה",
    });
  } catch (error) {
    console.error("Error removing small supplier:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
