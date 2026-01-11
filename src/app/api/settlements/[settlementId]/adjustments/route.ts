import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import { getSettlementPeriodById } from "@/data-access/settlements";
import {
  createAdjustment,
  getAdjustmentsBySettlementPeriod,
} from "@/data-access/adjustments";
import { createAuditContext } from "@/data-access/auditLog";
import type { AdjustmentType } from "@/db/schema";

// Manual discrepancy adjustment types with Hebrew labels
const DISCREPANCY_ADJUSTMENT_TYPES: Record<
  string,
  { value: AdjustmentType; labelHe: string; labelEn: string; requiresDescription: boolean }
> = {
  credit: {
    value: "credit",
    labelHe: "זיכוי",
    labelEn: "Credit",
    requiresDescription: false,
  },
  deposit: {
    value: "deposit",
    labelHe: "פיקדון",
    labelEn: "Deposit",
    requiresDescription: false,
  },
  supplier_error: {
    value: "supplier_error",
    labelHe: "טעות ספק",
    labelEn: "Supplier Error",
    requiresDescription: false,
  },
  timing: {
    value: "timing",
    labelHe: "הפרשי עיתוי",
    labelEn: "Timing Difference",
    requiresDescription: false,
  },
  other: {
    value: "other",
    labelHe: "אחר",
    labelEn: "Other",
    requiresDescription: true,
  },
};

// Valid manual adjustment types for discrepancies
const VALID_DISCREPANCY_TYPES: AdjustmentType[] = [
  "credit",
  "deposit",
  "supplier_error",
  "timing",
  "other",
];

/**
 * GET /api/settlements/[settlementId]/adjustments - Get all adjustments for a settlement
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ settlementId: string }> }
) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string }).role;
    if (userRole !== "super_user" && userRole !== "admin" && userRole !== "franchisee_owner") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { settlementId } = await params;

    // Verify settlement exists
    const settlement = await getSettlementPeriodById(settlementId);
    if (!settlement) {
      return NextResponse.json(
        { error: "Settlement period not found" },
        { status: 404 }
      );
    }

    const adjustments = await getAdjustmentsBySettlementPeriod(settlementId);

    return NextResponse.json({
      adjustments,
      adjustmentTypes: DISCREPANCY_ADJUSTMENT_TYPES,
    });
  } catch (error) {
    console.error("Error fetching adjustments:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settlements/[settlementId]/adjustments - Create a manual adjustment
 *
 * Request body:
 * {
 *   adjustmentType: "credit" | "deposit" | "supplier_error" | "timing" | "other"
 *   amount: string (decimal number)
 *   reason: string (required)
 *   description?: string (required for "other" type)
 *   referenceNumber?: string
 *   effectiveDate?: string (ISO date)
 *   metadata?: Record<string, unknown>
 * }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ settlementId: string }> }
) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only super_user and admin can create adjustments
    const userRole = (session.user as typeof session.user & { role?: string }).role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { settlementId } = await params;

    // Verify settlement exists
    const settlement = await getSettlementPeriodById(settlementId);
    if (!settlement) {
      return NextResponse.json(
        { error: "Settlement period not found" },
        { status: 404 }
      );
    }

    // Don't allow adjustments on invoiced settlements
    if (settlement.status === "invoiced") {
      return NextResponse.json(
        { error: "Cannot add adjustments to an invoiced settlement" },
        { status: 400 }
      );
    }

    const body = await request.json();

    // Validate required fields
    if (!body.adjustmentType) {
      return NextResponse.json(
        { error: "Adjustment type is required" },
        { status: 400 }
      );
    }

    if (!VALID_DISCREPANCY_TYPES.includes(body.adjustmentType)) {
      return NextResponse.json(
        { error: `Invalid adjustment type. Must be one of: ${VALID_DISCREPANCY_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    if (!body.amount || isNaN(parseFloat(body.amount))) {
      return NextResponse.json(
        { error: "Valid amount is required" },
        { status: 400 }
      );
    }

    if (!body.reason || typeof body.reason !== "string" || body.reason.trim() === "") {
      return NextResponse.json(
        { error: "Reason is required" },
        { status: 400 }
      );
    }

    // Validate description requirement for "other" type
    if (body.adjustmentType === "other") {
      if (!body.description || typeof body.description !== "string" || body.description.trim() === "") {
        return NextResponse.json(
          { error: "Description is required for 'other' adjustment type" },
          { status: 400 }
        );
      }
    }

    // Create audit context
    const auditContext = createAuditContext(session, request);

    // Prepare adjustment data
    const adjustmentData = {
      id: crypto.randomUUID(),
      settlementPeriodId: settlementId,
      adjustmentType: body.adjustmentType as AdjustmentType,
      amount: body.amount.toString(),
      reason: body.reason.trim(),
      description: body.description?.trim() || null,
      referenceNumber: body.referenceNumber?.trim() || null,
      effectiveDate: body.effectiveDate || null,
      metadata: {
        ...body.metadata,
        createdVia: "manual_discrepancy_adjustment",
        adjustmentTypeLabel: DISCREPANCY_ADJUSTMENT_TYPES[body.adjustmentType]?.labelHe,
      },
      createdBy: session.user.id,
      createdAt: new Date(),
      updatedAt: new Date(),
    };

    const newAdjustment = await createAdjustment(adjustmentData, auditContext);

    return NextResponse.json(
      {
        adjustment: newAdjustment,
        message: "Manual adjustment created successfully",
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error creating adjustment:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
