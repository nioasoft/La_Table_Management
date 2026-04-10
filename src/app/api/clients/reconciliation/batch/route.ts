/**
 * POST /api/clients/reconciliation/batch
 *
 * Create reconciliation sessions for ALL active clients for a given period.
 * Skips clients that already have a session for the period.
 * Returns summary of created/skipped/failed sessions.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { createClientReconciliationSession } from "@/data-access/client-reconciliation";
import { database } from "@/db";
import { client, clientReconciliationSession } from "@/db/schema";
import { eq, and } from "drizzle-orm";

export async function POST(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  const { user } = authResult;

  const body = await request.json();
  const { periodMonth, periodYear } = body;

  if (!periodMonth || !periodYear) {
    return NextResponse.json(
      { error: "נדרשים חודש ושנה" },
      { status: 400 }
    );
  }

  try {
    // Get all active clients (excluding GIFTCARD)
    const activeClients = await database
      .select({ id: client.id, name: client.name, code: client.code })
      .from(client)
      .where(eq(client.isActive, true));

    const filteredClients = activeClients.filter(
      (c) => c.code !== "GIFTCARD"
    );

    // Check which already have sessions for this period
    const existingSessions = await database
      .select({
        clientId: clientReconciliationSession.clientId,
      })
      .from(clientReconciliationSession)
      .where(
        and(
          eq(clientReconciliationSession.periodMonth, periodMonth),
          eq(clientReconciliationSession.periodYear, periodYear)
        )
      );

    const existingClientIds = new Set(existingSessions.map((s) => s.clientId));

    let created = 0;
    let skipped = 0;
    let failed = 0;
    const errors: string[] = [];

    for (const c of filteredClients) {
      if (existingClientIds.has(c.id)) {
        skipped++;
        continue;
      }

      try {
        await createClientReconciliationSession(
          c.id,
          periodMonth,
          periodYear,
          user.id
        );
        created++;
      } catch (error) {
        failed++;
        errors.push(
          `${c.name}: ${error instanceof Error ? error.message : "שגיאה"}`
        );
      }
    }

    return NextResponse.json({
      created,
      skipped,
      failed,
      total: filteredClients.length,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error in batch reconciliation:", error);
    return NextResponse.json(
      { error: "שגיאה ביצירת התאמות" },
      { status: 500 }
    );
  }
}
