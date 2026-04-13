/**
 * Client Reconciliation Notes API (by-franchisee view)
 *
 * POST — upsert a per-row note for (clientId, franchiseeId, periodMonth, periodYear).
 *        Notes can exist independently of approvals. Pass an empty/null note to clear it.
 *
 * Body schema: { clientId, franchiseeId, periodMonth, periodYear, note }
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { upsertReconciliationNote } from "@/data-access/client-reconciliation-approval";

interface Body {
  clientId?: string;
  franchiseeId?: string;
  periodMonth?: number;
  periodYear?: number;
  note?: string | null;
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

  try {
    const body = (await request.json()) as Body;
    const err = validate(body);
    if (err) return NextResponse.json({ error: err }, { status: 400 });

    await upsertReconciliationNote({
      clientId: body.clientId!,
      franchiseeId: body.franchiseeId!,
      periodMonth: body.periodMonth!,
      periodYear: body.periodYear!,
      note: body.note ?? null,
    });

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error upserting reconciliation note:", error);
    return NextResponse.json(
      { error: "שגיאה בשמירת ההערה" },
      { status: 500 }
    );
  }
}
