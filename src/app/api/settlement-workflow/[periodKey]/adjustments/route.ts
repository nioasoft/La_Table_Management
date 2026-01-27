import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import {
  createAdjustment,
  getAdjustmentsBySettlementPeriod,
  getAdjustmentById,
  updateAdjustment,
  deleteAdjustment,
  approveAdjustment,
} from "@/data-access/adjustments";
import { createAuditContext } from "@/data-access/auditLog";
import {
  getOrCreateSettlementPeriodByPeriodKey,
  getSettlementPeriodByPeriodKey,
} from "@/data-access/settlements";
import { getPeriodByKey } from "@/lib/settlement-periods";
import type { AdjustmentType } from "@/db/schema";
import { formatDateAsLocal } from "@/lib/date-utils";

// Valid adjustment types from schema
const VALID_ADJUSTMENT_TYPES: AdjustmentType[] = [
  "credit",
  "debit",
  "refund",
  "penalty",
  "bonus",
  "deposit",
  "supplier_error",
  "timing",
  "other",
];

/**
 * GET /api/settlement-workflow/[periodKey]/adjustments - Get adjustments for a period
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ periodKey: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { periodKey } = await params;
    const decodedKey = decodeURIComponent(periodKey);

    // Parse period info
    const periodInfo = getPeriodByKey(decodedKey);
    if (!periodInfo) {
      return NextResponse.json(
        { error: "תקופה לא נמצאה", periodKey: decodedKey },
        { status: 404 }
      );
    }

    // Get settlement period (if exists)
    const settlementPeriod = await getSettlementPeriodByPeriodKey(decodedKey);

    // If no settlement period exists yet, return empty adjustments
    if (!settlementPeriod) {
      return NextResponse.json({
        periodKey: decodedKey,
        periodInfo: {
          nameHe: periodInfo.nameHe,
          name: periodInfo.name,
          type: periodInfo.type,
          startDate: formatDateAsLocal(periodInfo.startDate),
          endDate: formatDateAsLocal(periodInfo.endDate),
        },
        settlementPeriodId: null,
        adjustments: [],
        summary: {
          total: 0,
          totalAmount: 0,
          pending: 0,
          approved: 0,
          byType: {},
        },
      });
    }

    // Get adjustments for this settlement period
    const adjustments = await getAdjustmentsBySettlementPeriod(settlementPeriod.id);

    // Calculate summary
    const summary = {
      total: adjustments.length,
      totalAmount: adjustments.reduce((sum, adj) => sum + parseFloat(adj.amount || "0"), 0),
      pending: adjustments.filter((adj) => !adj.approvedAt).length,
      approved: adjustments.filter((adj) => adj.approvedAt).length,
      byType: adjustments.reduce((acc, adj) => {
        const type = adj.adjustmentType || "other";
        acc[type] = (acc[type] || 0) + 1;
        return acc;
      }, {} as Record<string, number>),
    };

    return NextResponse.json({
      periodKey: decodedKey,
      periodInfo: {
        nameHe: periodInfo.nameHe,
        name: periodInfo.name,
        type: periodInfo.type,
        startDate: formatDateAsLocal(periodInfo.startDate),
        endDate: formatDateAsLocal(periodInfo.endDate),
      },
      settlementPeriodId: settlementPeriod.id,
      adjustments: adjustments.map((adj) => ({
        id: adj.id,
        adjustmentType: adj.adjustmentType,
        amount: parseFloat(adj.amount || "0"),
        reason: adj.reason,
        description: adj.description,
        referenceNumber: adj.referenceNumber,
        effectiveDate: adj.effectiveDate,
        approvedAt: adj.approvedAt?.toISOString(),
        approvedBy: adj.approvedBy,
        createdAt: adj.createdAt?.toISOString(),
        createdBy: adj.createdBy,
      })),
      summary,
    });
  } catch (error) {
    console.error("Error fetching adjustments:", error);
    return NextResponse.json(
      { error: "שגיאה פנימית" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/settlement-workflow/[periodKey]/adjustments - Create a new adjustment
 *
 * Body:
 * - adjustmentType: Required - one of the valid adjustment types
 * - amount: Required - decimal amount
 * - reason: Required - reason for the adjustment
 * - description: Optional - detailed description
 * - referenceNumber: Optional - reference number
 * - effectiveDate: Optional - date string (YYYY-MM-DD)
 * - crossReferenceId: Optional - associated cross-reference ID (stored in metadata)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ periodKey: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { periodKey } = await params;
    const decodedKey = decodeURIComponent(periodKey);

    // Parse request body
    const body = await request.json();
    const {
      adjustmentType,
      amount,
      reason,
      description,
      referenceNumber,
      effectiveDate,
      crossReferenceId,
    } = body;

    // Validate required fields
    if (!adjustmentType || !VALID_ADJUSTMENT_TYPES.includes(adjustmentType)) {
      return NextResponse.json(
        { error: `סוג התאמה לא תקין. סוגים תקינים: ${VALID_ADJUSTMENT_TYPES.join(", ")}` },
        { status: 400 }
      );
    }

    if (amount === undefined || amount === null || typeof amount !== "number") {
      return NextResponse.json(
        { error: "סכום חובה" },
        { status: 400 }
      );
    }

    if (!reason || typeof reason !== "string" || reason.trim() === "") {
      return NextResponse.json(
        { error: "סיבה חובה" },
        { status: 400 }
      );
    }

    // Get or create settlement period for this period key
    const result = await getOrCreateSettlementPeriodByPeriodKey(decodedKey, user.id);
    if (!result) {
      return NextResponse.json(
        { error: "תקופה לא נמצאה", periodKey: decodedKey },
        { status: 404 }
      );
    }

    const { settlementPeriod, created: periodCreated } = result;

    // Create audit context
    const auditContext = createAuditContext(
      { user: { id: user.id, name: user.name || user.email, email: user.email } },
      request
    );

    // Create the adjustment
    const newAdjustment = await createAdjustment(
      {
        id: crypto.randomUUID(),
        settlementPeriodId: settlementPeriod.id,
        adjustmentType: adjustmentType as AdjustmentType,
        amount: amount.toString(),
        reason: reason.trim(),
        description: description?.trim() || null,
        referenceNumber: referenceNumber?.trim() || null,
        effectiveDate: effectiveDate || null,
        createdBy: user.id,
        metadata: crossReferenceId ? { crossReferenceId } : null,
      },
      auditContext
    );

    return NextResponse.json({
      success: true,
      message: "ההתאמה נוצרה בהצלחה",
      adjustment: {
        id: newAdjustment.id,
        adjustmentType: newAdjustment.adjustmentType,
        amount: parseFloat(newAdjustment.amount || "0"),
        reason: newAdjustment.reason,
        description: newAdjustment.description,
        referenceNumber: newAdjustment.referenceNumber,
        effectiveDate: newAdjustment.effectiveDate,
        createdAt: newAdjustment.createdAt?.toISOString(),
        createdBy: newAdjustment.createdBy,
      },
      settlementPeriodCreated: periodCreated,
    });
  } catch (error) {
    console.error("Error creating adjustment:", error);
    return NextResponse.json(
      { error: "שגיאה ביצירת ההתאמה" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/settlement-workflow/[periodKey]/adjustments - Update or approve an adjustment
 *
 * Body:
 * - adjustmentId: Required - ID of adjustment to update
 * - action: Required - "update" | "approve" | "delete"
 * - For update:
 *   - amount, reason, description, referenceNumber, effectiveDate
 * - For approve:
 *   - no additional fields needed
 * - For delete:
 *   - no additional fields needed
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ periodKey: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const { adjustmentId, action, ...updateData } = body;

    if (!adjustmentId) {
      return NextResponse.json(
        { error: "adjustmentId נדרש" },
        { status: 400 }
      );
    }

    if (!action || !["update", "approve", "delete"].includes(action)) {
      return NextResponse.json(
        { error: "action נדרש (update, approve, delete)" },
        { status: 400 }
      );
    }

    // Verify adjustment exists
    const existingAdjustment = await getAdjustmentById(adjustmentId);
    if (!existingAdjustment) {
      return NextResponse.json(
        { error: "התאמה לא נמצאה" },
        { status: 404 }
      );
    }

    // Create audit context
    const auditContext = createAuditContext(
      { user: { id: user.id, name: user.name || user.email, email: user.email } },
      request
    );

    if (action === "delete") {
      const deleted = await deleteAdjustment(adjustmentId, auditContext, "מחיקה ידנית");
      if (!deleted) {
        return NextResponse.json(
          { error: "שגיאה במחיקת ההתאמה" },
          { status: 500 }
        );
      }
      return NextResponse.json({
        success: true,
        message: "ההתאמה נמחקה בהצלחה",
      });
    }

    if (action === "approve") {
      // Cannot approve already approved adjustment
      if (existingAdjustment.approvedAt) {
        return NextResponse.json(
          { error: "ההתאמה כבר אושרה" },
          { status: 400 }
        );
      }

      const approvedAdjustment = await approveAdjustment(adjustmentId, user.id, auditContext);
      if (!approvedAdjustment) {
        return NextResponse.json(
          { error: "שגיאה באישור ההתאמה" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "ההתאמה אושרה בהצלחה",
        adjustment: {
          id: approvedAdjustment.id,
          approvedAt: approvedAdjustment.approvedAt?.toISOString(),
          approvedBy: approvedAdjustment.approvedBy,
        },
      });
    }

    if (action === "update") {
      // Cannot update approved adjustment
      if (existingAdjustment.approvedAt) {
        return NextResponse.json(
          { error: "לא ניתן לעדכן התאמה שאושרה" },
          { status: 400 }
        );
      }

      // Build update data
      const updates: Record<string, unknown> = {};
      if (updateData.amount !== undefined && typeof updateData.amount === "number") {
        updates.amount = updateData.amount.toString();
      }
      if (updateData.reason !== undefined) {
        updates.reason = updateData.reason.trim();
      }
      if (updateData.description !== undefined) {
        updates.description = updateData.description?.trim() || null;
      }
      if (updateData.referenceNumber !== undefined) {
        updates.referenceNumber = updateData.referenceNumber?.trim() || null;
      }
      if (updateData.effectiveDate !== undefined) {
        updates.effectiveDate = updateData.effectiveDate || null;
      }

      if (Object.keys(updates).length === 0) {
        return NextResponse.json(
          { error: "אין שדות לעדכון" },
          { status: 400 }
        );
      }

      const updatedAdjustment = await updateAdjustment(
        adjustmentId,
        updates,
        auditContext,
        "עדכון ידני"
      );

      if (!updatedAdjustment) {
        return NextResponse.json(
          { error: "שגיאה בעדכון ההתאמה" },
          { status: 500 }
        );
      }

      return NextResponse.json({
        success: true,
        message: "ההתאמה עודכנה בהצלחה",
        adjustment: {
          id: updatedAdjustment.id,
          adjustmentType: updatedAdjustment.adjustmentType,
          amount: parseFloat(updatedAdjustment.amount || "0"),
          reason: updatedAdjustment.reason,
          description: updatedAdjustment.description,
          referenceNumber: updatedAdjustment.referenceNumber,
          effectiveDate: updatedAdjustment.effectiveDate,
          updatedAt: updatedAdjustment.updatedAt?.toISOString(),
        },
      });
    }

    return NextResponse.json(
      { error: "פעולה לא ידועה" },
      { status: 400 }
    );
  } catch (error) {
    console.error("Error updating adjustment:", error);
    return NextResponse.json(
      { error: "שגיאה בעדכון ההתאמה" },
      { status: 500 }
    );
  }
}
