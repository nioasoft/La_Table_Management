/**
 * Client Reconciliation Comparison Detail API
 *
 * PATCH - Update comparison status (approve/reject per row)
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { updateComparisonStatus } from "@/data-access/client-reconciliation";
import type { ReconciliationComparisonStatus } from "@/db/schema";

const VALID_STATUSES: ReconciliationComparisonStatus[] = [
  "pending",
  "auto_approved",
  "needs_review",
  "manually_approved",
  "sent_to_review_queue",
];

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ id: string }> }
) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  const { user } = authResult;

  const { id } = await params;

  try {
    const body = await request.json();
    const { status, reviewNotes, notes } = body;

    // Allow updating just notes without changing status
    if (!status && notes !== undefined) {
      const { updateComparisonNotes } = await import("@/data-access/client-reconciliation");
      const comparison = await updateComparisonNotes(id, notes);
      return NextResponse.json(comparison);
    }

    if (!status || !VALID_STATUSES.includes(status)) {
      return NextResponse.json(
        { error: "סטטוס לא תקין" },
        { status: 400 }
      );
    }

    const comparison = await updateComparisonStatus(
      id,
      status,
      user.id,
      reviewNotes
    );

    return NextResponse.json(comparison);
  } catch (error) {
    console.error("Error updating comparison:", error);
    return NextResponse.json(
      { error: "שגיאה בעדכון השוואה" },
      { status: 500 }
    );
  }
}
