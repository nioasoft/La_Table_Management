import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getAllVatRates,
  createVatRate,
  isEffectiveDateUnique,
  getVatRateStats,
} from "@/data-access/vatRates";

/**
 * GET /api/vat-rates - Get all VAT rates (Admin/Super User only)
 *
 * Query params:
 * - stats: "true" to include statistics
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;
    const includeStats = searchParams.get("stats") === "true";

    const vatRates = await getAllVatRates();
    const stats = includeStats ? await getVatRateStats() : null;

    return NextResponse.json({ vatRates, stats });
  } catch (error) {
    console.error("Error fetching VAT rates:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/vat-rates - Create a new VAT rate (Admin/Super User only)
 *
 * Request body:
 * - rate: number (decimal, e.g., 0.18 for 18%)
 * - effectiveFrom: string (YYYY-MM-DD format)
 * - description?: string
 * - notes?: string
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const { rate, effectiveFrom, description, notes } = body;

    // Validate required fields
    if (rate === undefined || rate === null) {
      return NextResponse.json(
        { error: "Rate is required" },
        { status: 400 }
      );
    }

    if (!effectiveFrom) {
      return NextResponse.json(
        { error: "Effective from date is required" },
        { status: 400 }
      );
    }

    // Validate rate is a valid decimal
    const rateNum = parseFloat(rate);
    if (isNaN(rateNum) || rateNum < 0 || rateNum > 1) {
      return NextResponse.json(
        { error: "Rate must be a decimal between 0 and 1 (e.g., 0.18 for 18%)" },
        { status: 400 }
      );
    }

    // Validate date format
    const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
    if (!dateRegex.test(effectiveFrom)) {
      return NextResponse.json(
        { error: "Effective from must be in YYYY-MM-DD format" },
        { status: 400 }
      );
    }

    // Check if effective date is unique
    const isUnique = await isEffectiveDateUnique(effectiveFrom);
    if (!isUnique) {
      return NextResponse.json(
        { error: "A VAT rate already exists for this effective date" },
        { status: 400 }
      );
    }

    const newVatRate = await createVatRate({
      rate: String(rateNum),
      effectiveFrom,
      description: description || null,
      notes: notes || null,
      createdBy: user.id,
    });

    return NextResponse.json({ vatRate: newVatRate }, { status: 201 });
  } catch (error) {
    console.error("Error creating VAT rate:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
