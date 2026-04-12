/**
 * Client Reconciliation Approvals API (by-franchisee view)
 *
 * POST   — mark a single (client, franchisee, period) row as approved.
 * DELETE — remove that approval.
 *
 * Body schema: { clientId, franchiseeId, periodMonth, periodYear, notes? }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import {
  approveReconciliation,
  unapproveReconciliation,
} from "@/data-access/client-reconciliation-approval";

interface Body {
  clientId?: string;
  franchiseeId?: string;
  periodMonth?: number;
  periodYear?: number;
  notes?: string;
}

function validate(body: Body) {
  const { clientId, franchiseeId, periodMonth, periodYear } = body;
  if (
    !clientId ||
    !franchiseeId ||
    typeof periodMonth !== "number" ||
    typeof periodYear !== "number" ||
    periodMonth < 1 ||
    periodMonth > 12 ||
    periodYear < 2000
  ) {
    return "נדרשים clientId, franchiseeId, periodMonth (1-12), periodYear";
  }
  return null;
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  const { user } = authResult;

  try {
    const body = (await request.json()) as Body;
    const err = validate(body);
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    await approveReconciliation({
      clientId: body.clientId!,
      franchiseeId: body.franchiseeId!,
      periodMonth: body.periodMonth!,
      periodYear: body.periodYear!,
      approvedBy: user.id,
      notes: body.notes,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error approving reconciliation:", error);
    return NextResponse.json(
      { error: "שגיאה באישור ההשוואה" },
      { status: 500 }
    );
  }
}

export async function DELETE(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  try {
    const body = (await request.json()) as Body;
    const err = validate(body);
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    await unapproveReconciliation({
      clientId: body.clientId!,
      franchiseeId: body.franchiseeId!,
      periodMonth: body.periodMonth!,
      periodYear: body.periodYear!,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error unapproving reconciliation:", error);
    return NextResponse.json(
      { error: "שגיאה בביטול האישור" },
      { status: 500 }
    );
  }
}
