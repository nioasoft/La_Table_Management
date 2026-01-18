import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getVatRateById,
  updateVatRate,
  deleteVatRate,
  isEffectiveDateUnique,
} from "@/data-access/vatRates";

interface RouteContext {
  params: Promise<{ id: string }>;
}

/**
 * GET /api/vat-rates/[id] - Get a specific VAT rate (Admin/Super User only)
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { id } = await context.params;
    const vatRate = await getVatRateById(id);

    if (!vatRate) {
      return NextResponse.json(
        { error: "VAT rate not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({ vatRate });
  } catch (error) {
    console.error("Error fetching VAT rate:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/vat-rates/[id] - Update a VAT rate (Admin/Super User only)
 *
 * Request body (all optional):
 * - rate: number (decimal, e.g., 0.18 for 18%)
 * - effectiveFrom: string (YYYY-MM-DD format)
 * - description: string | null
 * - notes: string | null
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { id } = await context.params;
    const existingVatRate = await getVatRateById(id);

    if (!existingVatRate) {
      return NextResponse.json(
        { error: "VAT rate not found" },
        { status: 404 }
      );
    }

    const body = await request.json();
    const { rate, effectiveFrom, description, notes } = body;

    // Build update data
    const updateData: Record<string, unknown> = {};

    // Validate and set rate if provided
    if (rate !== undefined) {
      const rateNum = parseFloat(rate);
      if (isNaN(rateNum) || rateNum < 0 || rateNum > 1) {
        return NextResponse.json(
          { error: "Rate must be a decimal between 0 and 1 (e.g., 0.18 for 18%)" },
          { status: 400 }
        );
      }
      updateData.rate = String(rateNum);
    }

    // Validate and set effective date if provided
    if (effectiveFrom !== undefined) {
      const dateRegex = /^\d{4}-\d{2}-\d{2}$/;
      if (!dateRegex.test(effectiveFrom)) {
        return NextResponse.json(
          { error: "Effective from must be in YYYY-MM-DD format" },
          { status: 400 }
        );
      }

      // Check if new effective date is unique (excluding current record)
      const isUnique = await isEffectiveDateUnique(effectiveFrom, id);
      if (!isUnique) {
        return NextResponse.json(
          { error: "A VAT rate already exists for this effective date" },
          { status: 400 }
        );
      }
      updateData.effectiveFrom = effectiveFrom;
    }

    // Set optional fields
    if (description !== undefined) {
      updateData.description = description;
    }
    if (notes !== undefined) {
      updateData.notes = notes;
    }

    // Check if there's anything to update
    if (Object.keys(updateData).length === 0) {
      return NextResponse.json(
        { error: "No valid fields to update" },
        { status: 400 }
      );
    }

    const updatedVatRate = await updateVatRate(id, updateData);

    return NextResponse.json({ vatRate: updatedVatRate });
  } catch (error) {
    console.error("Error updating VAT rate:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/vat-rates/[id] - Delete a VAT rate (Admin/Super User only)
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { id } = await context.params;
    const existingVatRate = await getVatRateById(id);

    if (!existingVatRate) {
      return NextResponse.json(
        { error: "VAT rate not found" },
        { status: 404 }
      );
    }

    const deleted = await deleteVatRate(id);

    if (!deleted) {
      return NextResponse.json(
        { error: "Failed to delete VAT rate" },
        { status: 500 }
      );
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting VAT rate:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
