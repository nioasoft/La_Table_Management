/**
 * Batch approve all mismatch rows for a franchisee+period.
 *
 * POST body: { franchiseeId, periodMonth, periodYear }
 *
 * Recomputes mismatch rows using the same logic as the by-franchisee GET
 * endpoint, then upserts approvals for each client ID in mismatch state.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { database } from "@/db";
import { clientDocument, client } from "@/db/schema";
import { and, eq } from "drizzle-orm";
import { batchApproveForFranchisee } from "@/data-access/client-reconciliation-approval";

const THRESHOLD = 30;

interface Body {
  franchiseeId?: string;
  periodMonth?: number;
  periodYear?: number;
}

export async function POST(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;
  const { user } = authResult;

  try {
    const body = (await request.json()) as Body;
    const { franchiseeId, periodMonth, periodYear } = body;

    if (
      !franchiseeId ||
      typeof periodMonth !== "number" ||
      typeof periodYear !== "number"
    ) {
      return NextResponse.json(
        { error: "נדרשים franchiseeId, periodMonth, periodYear" },
        { status: 400 }
      );
    }

    // Compute mismatch client IDs (same logic as by-franchisee GET)
    const docs = await database
      .select({
        clientId: clientDocument.clientId,
        documentType: clientDocument.documentType,
        totalAmount: clientDocument.totalAmount,
      })
      .from(clientDocument)
      .where(
        and(
          eq(clientDocument.franchiseeId, franchiseeId),
          eq(clientDocument.periodMonth, periodMonth),
          eq(clientDocument.periodYear, periodYear)
        )
      );

    const clientReports = new Map<string, number>();
    const tabitReports = new Map<string, number>();
    for (const d of docs) {
      if (!d.clientId) continue;
      const amount = d.totalAmount ? parseFloat(d.totalAmount) : 0;
      if (d.documentType === "client_report") {
        clientReports.set(d.clientId, (clientReports.get(d.clientId) ?? 0) + amount);
      } else if (d.documentType === "tabit_report") {
        tabitReports.set(d.clientId, (tabitReports.get(d.clientId) ?? 0) + amount);
      }
    }

    // Load client codes (for GIFTCARD carve-out)
    const allClientIds = Array.from(
      new Set([...clientReports.keys(), ...tabitReports.keys()])
    );
    const clients = await database
      .select({ id: client.id, code: client.code })
      .from(client);
    const clientCodeMap = new Map(clients.map((c) => [c.id, c.code]));

    const mismatchClientIds: string[] = [];
    for (const clientId of allClientIds) {
      const clientAmt = clientReports.get(clientId) ?? null;
      const tabitAmt = tabitReports.get(clientId) ?? null;
      if (clientAmt !== null && tabitAmt !== null) {
        const diff = Math.abs(clientAmt - tabitAmt);
        if (diff > THRESHOLD) mismatchClientIds.push(clientId);
        continue;
      }
      const code = clientCodeMap.get(clientId);
      // Include "missing_client" and "missing_tabit" in batch approve too (user
      // intent: "approve all"); GIFTCARD with tabit-only counts as ok, skip.
      if (code === "GIFTCARD" && tabitAmt !== null) continue;
      if (clientAmt !== null || tabitAmt !== null) {
        mismatchClientIds.push(clientId);
      }
    }

    const approvedCount = await batchApproveForFranchisee({
      franchiseeId,
      periodMonth,
      periodYear,
      approvedBy: user.id,
      clientIds: mismatchClientIds,
    });

    return NextResponse.json({ approvedCount });
  } catch (error) {
    console.error("Error in batch approve:", error);
    return NextResponse.json(
      { error: "שגיאה באישור מרובה" },
      { status: 500 }
    );
  }
}
