import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getCrossReferenceById,
  updateMatchStatus,
  type CrossReferenceComparisonMetadata,
} from "@/data-access/crossReferences";

/**
 * POST /api/reconciliation/bulk-approve - Bulk approve matched items
 * Body:
 * - crossReferenceIds: Required - Array of cross-reference IDs to approve
 * - reviewNotes: Optional - Notes to add to all approved items
 */
export async function POST(request: NextRequest) {
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

    const body = await request.json();
    const { crossReferenceIds, reviewNotes } = body;

    // Validate required fields
    if (!crossReferenceIds || !Array.isArray(crossReferenceIds) || crossReferenceIds.length === 0) {
      return NextResponse.json(
        { error: "crossReferenceIds is required and must be a non-empty array" },
        { status: 400 }
      );
    }

    const results = {
      approved: 0,
      failed: 0,
      skipped: 0,
      errors: [] as { id: string; error: string }[],
    };

    // Process each cross-reference
    for (const crossRefId of crossReferenceIds) {
      try {
        // Get the cross-reference to check its current status
        const crossRef = await getCrossReferenceById(crossRefId);

        if (!crossRef) {
          results.failed++;
          results.errors.push({ id: crossRefId, error: "Not found" });
          continue;
        }

        const metadata = crossRef.metadata as CrossReferenceComparisonMetadata;

        // Only approve items that are 'matched' or 'pending' status
        // Skip items that are already marked as discrepancy (they need manual review)
        if (metadata?.matchStatus === "discrepancy") {
          results.skipped++;
          results.errors.push({ id: crossRefId, error: "Cannot bulk approve discrepancy items - requires manual review" });
          continue;
        }

        // Update the status to matched with review notes
        const updated = await updateMatchStatus(
          crossRefId,
          "matched",
          session.user.id,
          reviewNotes || "Bulk approved"
        );

        if (updated) {
          results.approved++;
        } else {
          results.failed++;
          results.errors.push({ id: crossRefId, error: "Failed to update" });
        }
      } catch (error) {
        results.failed++;
        results.errors.push({
          id: crossRefId,
          error: error instanceof Error ? error.message : "Unknown error"
        });
      }
    }

    return NextResponse.json({
      message: "Bulk approval completed",
      total: crossReferenceIds.length,
      approved: results.approved,
      failed: results.failed,
      skipped: results.skipped,
      errors: results.errors.length > 0 ? results.errors : undefined,
    });
  } catch (error) {
    console.error("Error performing bulk approval:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
