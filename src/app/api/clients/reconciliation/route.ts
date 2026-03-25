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
import { database } from "@/db";
import { clientReconciliationSession } from "@/db/schema";
import { eq, and } from "drizzle-orm";

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

  const body = await request.json();
  const { clientId, periodMonth, periodYear } = body;

  if (!clientId || !periodMonth || !periodYear) {
    return NextResponse.json(
      { error: "נדרשים לקוח, חודש ושנה" },
      { status: 400 }
    );
  }

  try {
    const session = await createClientReconciliationSession(
      clientId,
      periodMonth,
      periodYear,
      user.id
    );

    return NextResponse.json(session, { status: 201 });
  } catch (error) {
    // Check for unique constraint violation (session already exists)
    const dbError = error as { code?: string };
    if (dbError.code === "23505") {
      const [existing] = await database
        .select({ id: clientReconciliationSession.id })
        .from(clientReconciliationSession)
        .where(
          and(
            eq(clientReconciliationSession.clientId, clientId),
            eq(clientReconciliationSession.periodMonth, periodMonth),
            eq(clientReconciliationSession.periodYear, periodYear)
          )
        )
        .limit(1);

      return NextResponse.json(
        {
          error: "קיים כבר סשן התאמה לתקופה זו",
          existingSessionId: existing?.id ?? null,
        },
        { status: 409 }
      );
    }

    const message = error instanceof Error ? error.message : "שגיאה ביצירת התאמה";
    console.error("Error creating client reconciliation session:", error);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
