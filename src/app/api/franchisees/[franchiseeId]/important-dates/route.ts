import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getImportantDatesByFranchisee,
  createImportantDate,
  type CreateImportantDateInput,
} from "@/data-access/franchiseeImportantDates";
import { getFranchiseeById } from "@/data-access/franchisees";

interface RouteContext {
  params: Promise<{ franchiseeId: string }>;
}

/**
 * GET /api/franchisees/[franchiseeId]/important-dates - Get all important dates for a franchisee
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { franchiseeId } = await context.params;

    // Verify franchisee exists
    const franchisee = await getFranchiseeById(franchiseeId);
    if (!franchisee) {
      return NextResponse.json(
        { error: "Franchisee not found" },
        { status: 404 }
      );
    }

    const importantDates = await getImportantDatesByFranchisee(franchiseeId);

    return NextResponse.json({ importantDates });
  } catch (error) {
    console.error("Error fetching important dates:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/franchisees/[franchiseeId]/important-dates - Create a new important date
 */
export async function POST(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { franchiseeId } = await context.params;
    const body = await request.json();

    // Verify franchisee exists
    const franchisee = await getFranchiseeById(franchiseeId);
    if (!franchisee) {
      return NextResponse.json(
        { error: "Franchisee not found" },
        { status: 404 }
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

    // Validate required fields
    if (!dateType) {
      return NextResponse.json(
        { error: "Date type is required" },
        { status: 400 }
      );
    }

    if (!startDate) {
      return NextResponse.json(
        { error: "Start date is required" },
        { status: 400 }
      );
    }

    if (!durationMonths || durationMonths < 1) {
      return NextResponse.json(
        { error: "Duration must be at least 1 month" },
        { status: 400 }
      );
    }

    // Validate custom type has a name
    if (dateType === "custom" && !customTypeName) {
      return NextResponse.json(
        { error: "Custom type name is required for custom date types" },
        { status: 400 }
      );
    }

    const input: CreateImportantDateInput = {
      franchiseeId,
      dateType,
      customTypeName: dateType === "custom" ? customTypeName : undefined,
      startDate,
      durationMonths,
      displayUnit,
      reminderMonthsBefore,
      description,
      notes,
      isActive,
      createdBy: user.id,
    };

    const importantDate = await createImportantDate(input);

    return NextResponse.json({ importantDate }, { status: 201 });
  } catch (error) {
    console.error("Error creating important date:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
