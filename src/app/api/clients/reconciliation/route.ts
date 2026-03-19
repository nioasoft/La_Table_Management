/**
 * Client Reconciliation Sessions API
 *
 * GET  - List sessions (optional ?clientId= filter)
 * POST - Create a new reconciliation session
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import {
  createClientReconciliationSession,
  getClientReconciliationSessions,
} from "@/data-access/client-reconciliation";

export async function GET(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const { searchParams } = new URL(request.url);
  const clientId = searchParams.get("clientId") ?? undefined;

  try {
    const sessions = await getClientReconciliationSessions(clientId);
    return NextResponse.json(sessions);
  } catch (error) {
    console.error("Error fetching client reconciliation sessions:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת התאמות" },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  const { user } = authResult;

  try {
    const { clientId, periodMonth, periodYear } = await request.json();

    if (!clientId || !periodMonth || !periodYear) {
      return NextResponse.json(
        { error: "נדרשים לקוח, חודש ושנה" },
        { status: 400 }
      );
    }

    const session = await createClientReconciliationSession(
      clientId,
      periodMonth,
      periodYear,
      user.id
    );

    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "שגיאה ביצירת התאמה";
    console.error("Error creating client reconciliation session:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
