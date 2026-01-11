import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getCrossReferenceById,
  updateCrossReference,
  type CrossReferenceComparisonMetadata,
} from "@/data-access/crossReferences";
import { createAuditContext, logAuditEvent } from "@/data-access/auditLog";

/**
 * Resolution types for discrepancy handling
 */
type ResolutionType =
  | "accept_supplier"
  | "accept_franchisee"
  | "adjustment"
  | "request_correction";

/**
 * POST /api/reconciliation/[crossRefId]/resolve - Resolve a discrepancy
 * Body:
 * - resolutionType: Required - Type of resolution (accept_supplier, accept_franchisee, adjustment, request_correction)
 * - adjustmentType: Optional - Type of adjustment if resolutionType is "adjustment"
 * - adjustmentAmount: Optional - Amount if resolutionType is "adjustment"
 * - explanation: Required - Explanation for the resolution
 * - newMatchStatus: Optional - New match status (defaults based on resolution type)
 * - resolvedAmount: Optional - The resolved amount
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ crossRefId: string }> }
) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin or super_user
    const userRole = (session.user as typeof session.user & { role?: string }).role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { crossRefId } = await params;
    const body = await request.json();
    const {
      resolutionType,
      adjustmentType,
      adjustmentAmount,
      explanation,
      newMatchStatus,
      resolvedAmount,
    } = body;

    // Validate required fields
    if (!resolutionType) {
      return NextResponse.json(
        { error: "Resolution type is required" },
        { status: 400 }
      );
    }

    if (!explanation || explanation.trim().length === 0) {
      return NextResponse.json(
        { error: "Explanation is required" },
        { status: 400 }
      );
    }

    // Validate resolution type
    const validResolutionTypes: ResolutionType[] = [
      "accept_supplier",
      "accept_franchisee",
      "adjustment",
      "request_correction",
    ];
    if (!validResolutionTypes.includes(resolutionType as ResolutionType)) {
      return NextResponse.json(
        { error: "Invalid resolution type" },
        { status: 400 }
      );
    }

    // Validate adjustment fields if resolution type is adjustment
    if (resolutionType === "adjustment") {
      if (!adjustmentType) {
        return NextResponse.json(
          { error: "Adjustment type is required for adjustment resolution" },
          { status: 400 }
        );
      }
      if (adjustmentAmount === undefined || adjustmentAmount === null) {
        return NextResponse.json(
          { error: "Adjustment amount is required for adjustment resolution" },
          { status: 400 }
        );
      }
    }

    // Check if cross-reference exists
    const existing = await getCrossReferenceById(crossRefId);
    if (!existing) {
      return NextResponse.json(
        { error: "Cross-reference not found" },
        { status: 404 }
      );
    }

    const currentMetadata = (existing.metadata as CrossReferenceComparisonMetadata) || {};

    // Determine the new match status
    let finalMatchStatus = newMatchStatus;
    if (!finalMatchStatus) {
      // Default match status based on resolution type
      if (resolutionType === "request_correction") {
        finalMatchStatus = "discrepancy"; // Keep as discrepancy until corrected file is received
      } else {
        finalMatchStatus = "matched"; // Mark as matched for other resolution types
      }
    }

    // Build resolution metadata
    const resolutionMetadata: CrossReferenceComparisonMetadata = {
      ...currentMetadata,
      matchStatus: finalMatchStatus,
      manualReview: false, // No longer needs review
      resolutionType,
      resolutionExplanation: explanation.trim(),
      resolvedBy: session.user.id,
      resolvedAt: new Date().toISOString(),
      reviewedBy: session.user.id,
      reviewedAt: new Date().toISOString(),
      reviewNotes: explanation.trim(),
    };

    // Add adjustment-specific metadata
    if (resolutionType === "adjustment") {
      resolutionMetadata.resolutionAmount = adjustmentAmount.toString();
      // Track adjustment type in metadata
      (resolutionMetadata as Record<string, unknown>).adjustmentType = adjustmentType;
    } else if (resolvedAmount) {
      resolutionMetadata.resolutionAmount = resolvedAmount;
    }

    // Update the cross-reference
    const updated = await updateCrossReference(crossRefId, {
      metadata: resolutionMetadata,
    });

    if (!updated) {
      return NextResponse.json(
        { error: "Failed to update cross-reference" },
        { status: 500 }
      );
    }

    // Create audit log entry
    try {
      const auditContext = createAuditContext(session, request);
      await logAuditEvent(
        auditContext,
        "update",
        "settlement_period", // Using settlement_period as closest match in enum for cross-reference
        crossRefId,
        {
          entityName: `Discrepancy Resolution: ${resolutionType}`,
          beforeValue: {
            matchStatus: currentMetadata.matchStatus,
            supplierAmount: currentMetadata.supplierAmount,
            franchiseeAmount: currentMetadata.franchiseeAmount,
            difference: currentMetadata.difference,
          },
          afterValue: {
            matchStatus: finalMatchStatus,
            resolutionType,
            adjustmentType,
            adjustmentAmount,
            explanation: explanation.trim(),
          },
          reason: "Discrepancy resolution submitted",
          notes: explanation.trim(),
        }
      );
    } catch (auditError) {
      // Log audit error but don't fail the request
      console.error("Error creating audit log:", auditError);
    }

    return NextResponse.json({
      success: true,
      crossReference: updated,
      resolution: {
        type: resolutionType,
        status: finalMatchStatus,
        explanation: explanation.trim(),
        resolvedAt: resolutionMetadata.resolvedAt,
      },
    });
  } catch (error) {
    console.error("Error resolving discrepancy:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
