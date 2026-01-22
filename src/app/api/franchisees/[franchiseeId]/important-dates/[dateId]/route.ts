import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getImportantDateById,
  updateImportantDate,
  deleteImportantDate,
  copyImportantDate,
  type UpdateImportantDateInput,
} from "@/data-access/franchiseeImportantDates";
import { type ImportantDateType } from "@/db/schema";

interface RouteContext {
  params: Promise<{ franchiseeId: string; dateId: string }>;
}

/**
 * GET /api/franchisees/[franchiseeId]/important-dates/[dateId] - Get a single important date
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { franchiseeId, dateId } = await context.params;

    const importantDate = await getImportantDateById(dateId);
    if (!importantDate) {
      return NextResponse.json(
        { error: "Important date not found" },
        { status: 404 }
      );
    }

    // Verify the date belongs to the specified franchisee
    if (importantDate.franchiseeId !== franchiseeId) {
      return NextResponse.json(
        { error: "Important date does not belong to this franchisee" },
        { status: 403 }
      );
    }

    return NextResponse.json({ importantDate });
  } catch (error) {
    console.error("Error fetching important date:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/franchisees/[franchiseeId]/important-dates/[dateId] - Update an important date
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { franchiseeId, dateId } = await context.params;
    const body = await request.json();

    // Check if important date exists
    const existingDate = await getImportantDateById(dateId);
    if (!existingDate) {
      return NextResponse.json(
        { error: "Important date not found" },
        { status: 404 }
      );
    }

    // Verify the date belongs to the specified franchisee
    if (existingDate.franchiseeId !== franchiseeId) {
      return NextResponse.json(
        { error: "Important date does not belong to this franchisee" },
        { status: 403 }
      );
    }

    const {
      dateType,
      customTypeName,
      startDate,
      durationMonths,
      displayUnit,
      reminderMonthsBefore,
      description,
      notes,
      isActive,
    } = body;

    // Validate duration if provided
    if (durationMonths !== undefined && durationMonths < 1) {
      return NextResponse.json(
        { error: "Duration must be at least 1 month" },
        { status: 400 }
      );
    }

    // Validate custom type has a name if changing to custom
    if (dateType === "custom" && !customTypeName && !existingDate.customTypeName) {
      return NextResponse.json(
        { error: "Custom type name is required for custom date types" },
        { status: 400 }
      );
    }

    const input: UpdateImportantDateInput = {};

    if (dateType !== undefined) input.dateType = dateType;
    if (customTypeName !== undefined) input.customTypeName = customTypeName;
    if (startDate !== undefined) input.startDate = startDate;
    if (durationMonths !== undefined) input.durationMonths = durationMonths;
    if (displayUnit !== undefined) input.displayUnit = displayUnit;
    if (reminderMonthsBefore !== undefined) input.reminderMonthsBefore = reminderMonthsBefore;
    if (description !== undefined) input.description = description;
    if (notes !== undefined) input.notes = notes;
    if (isActive !== undefined) input.isActive = isActive;

    const updatedDate = await updateImportantDate(dateId, input);
    if (!updatedDate) {
      return NextResponse.json(
        { error: "Important date not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ importantDate: updatedDate });
  } catch (error) {
    console.error("Error updating important date:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/franchisees/[franchiseeId]/important-dates/[dateId] - Delete an important date
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { franchiseeId, dateId } = await context.params;

    // Check if important date exists
    const existingDate = await getImportantDateById(dateId);
    if (!existingDate) {
      return NextResponse.json(
        { error: "Important date not found" },
        { status: 404 }
      );
    }

    // Verify the date belongs to the specified franchisee
    if (existingDate.franchiseeId !== franchiseeId) {
      return NextResponse.json(
        { error: "Important date does not belong to this franchisee" },
        { status: 403 }
      );
    }

    const deleted = await deleteImportantDate(dateId);
    if (!deleted) {
      return NextResponse.json(
        { error: "Important date not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting important date:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/franchisees/[franchiseeId]/important-dates/[dateId] - Copy an important date to a new type
 * Body: { targetType: ImportantDateType, customTypeName?: string }
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { franchiseeId, dateId } = await context.params;
    const body = await request.json();

    // Check if important date exists
    const existingDate = await getImportantDateById(dateId);
    if (!existingDate) {
      return NextResponse.json(
        { error: "Important date not found" },
        { status: 404 }
      );
    }

    // Verify the date belongs to the specified franchisee
    if (existingDate.franchiseeId !== franchiseeId) {
      return NextResponse.json(
        { error: "Important date does not belong to this franchisee" },
        { status: 403 }
      );
    }

    const { targetType, customTypeName } = body;

    if (!targetType) {
      return NextResponse.json(
        { error: "Target type is required" },
        { status: 400 }
      );
    }

    // Validate custom type has a name if copying to custom
    if (targetType === "custom" && !customTypeName) {
      return NextResponse.json(
        { error: "Custom type name is required when copying to custom type" },
        { status: 400 }
      );
    }

    const copiedDate = await copyImportantDate(dateId, targetType as ImportantDateType, customTypeName);
    if (!copiedDate) {
      return NextResponse.json(
        { error: "Failed to copy important date" },
        { status: 500 }
      );
    }

    return NextResponse.json({ importantDate: copiedDate }, { status: 201 });
  } catch (error) {
    console.error("Error copying important date:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
