/**
 * GET /api/clients/reconciliation/by-franchisee
 *
 * Returns reconciliation data for a single franchisee across all clients.
 * Compares client_report amounts vs tabit_report amounts per client.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { database } from "@/db";
import { clientDocument, client, clientFranchisee, franchisee } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { getApprovalsByFranchisee } from "@/data-access/client-reconciliation-approval";

const THRESHOLD = 30; // NIS

interface ByFranchiseeRow {
  clientId: string;
  clientName: string;
  clientCode: string | null;
  clientAmount: number | null;
  tabitAmount: number | null;
  difference: number | null;
  absoluteDifference: number | null;
  status: "ok" | "mismatch" | "missing_client" | "missing_tabit" | "missing_both";
  approvedAt: string | null;
  approvedBy: string | null;
  approvedByName: string | null;
  approvalNotes: string | null;
  // Latest document id per side (null if none). UI links via
  // /api/clients/documents/[id]/download which 302s to storage.
  clientFileDocId: string | null;
  clientFileName: string | null;
  tabitFileDocId: string | null;
  tabitFileName: string | null;
  // The platform's commission invoice for this (client, franchisee, period).
  // Reut reconciles from this screen and the invoice was not reachable here at
  // all — clicking the only document icon always produced the report, which
  // read as "the invoice is missing" even once it was in the system
  // (10bis, July 2026).
  invoiceFileDocId: string | null;
  invoiceFileName: string | null;
  invoiceAmount: number | null;
}

export async function GET(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const { searchParams } = new URL(request.url);
  const franchiseeId = searchParams.get("franchiseeId");
  const periodMonth = parseInt(searchParams.get("periodMonth") ?? "");
  const periodYear = parseInt(searchParams.get("periodYear") ?? "");

  if (!franchiseeId || isNaN(periodMonth) || isNaN(periodYear)) {
    return NextResponse.json(
      { error: "נדרשים franchiseeId, periodMonth, periodYear" },
      { status: 400 }
    );
  }

  try {
    // Get franchisee name
    const [fr] = await database
      .select({ name: franchisee.name })
      .from(franchisee)
      .where(eq(franchisee.id, franchiseeId))
      .limit(1);

    if (!fr) {
      return NextResponse.json({ error: "זכיין לא נמצא" }, { status: 404 });
    }

    // Get all documents for this franchisee + period
    const docs = await database
      .select({
        id: clientDocument.id,
        clientId: clientDocument.clientId,
        documentType: clientDocument.documentType,
        totalAmount: clientDocument.totalAmount,
        fileUrl: clientDocument.fileUrl,
        originalFileName: clientDocument.originalFileName,
        createdAt: clientDocument.createdAt,
      })
      .from(clientDocument)
      .where(
        and(
          eq(clientDocument.franchiseeId, franchiseeId),
          eq(clientDocument.periodMonth, periodMonth),
          eq(clientDocument.periodYear, periodYear)
        )
      );

    // Group by clientId
    const clientReports = new Map<string, number>();
    const tabitReports = new Map<string, number>();

    // Latest file per (clientId, type) — chosen by createdAt desc.
    // Tracks the doc id so the UI can link via the auth-protected
    // download endpoint (which itself follows fileUrl).
    interface LatestFile {
      docId: string;
      hasUrl: boolean;
      name: string;
      createdAt: Date;
    }
    const latestClientFile = new Map<string, LatestFile>();
    const latestTabitFile = new Map<string, LatestFile>();
    const latestInvoiceFile = new Map<string, LatestFile>();
    const invoiceAmounts = new Map<string, number>();

    for (const doc of docs) {
      if (!doc.clientId) continue;
      const amount = doc.totalAmount ? parseFloat(doc.totalAmount) : 0;

      if (doc.documentType === "client_report") {
        clientReports.set(
          doc.clientId,
          (clientReports.get(doc.clientId) ?? 0) + amount
        );
        const prev = latestClientFile.get(doc.clientId);
        if (!prev || doc.createdAt > prev.createdAt) {
          latestClientFile.set(doc.clientId, {
            docId: doc.id,
            hasUrl: !!doc.fileUrl,
            name: doc.originalFileName,
            createdAt: doc.createdAt,
          });
        }
      } else if (doc.documentType === "commission_invoice") {
        invoiceAmounts.set(
          doc.clientId,
          (invoiceAmounts.get(doc.clientId) ?? 0) + amount
        );
        const prev = latestInvoiceFile.get(doc.clientId);
        if (!prev || doc.createdAt > prev.createdAt) {
          latestInvoiceFile.set(doc.clientId, {
            docId: doc.id,
            hasUrl: !!doc.fileUrl,
            name: doc.originalFileName,
            createdAt: doc.createdAt,
          });
        }
      } else if (doc.documentType === "tabit_report") {
        tabitReports.set(
          doc.clientId,
          (tabitReports.get(doc.clientId) ?? 0) + amount
        );
        const prev = latestTabitFile.get(doc.clientId);
        if (!prev || doc.createdAt > prev.createdAt) {
          latestTabitFile.set(doc.clientId, {
            docId: doc.id,
            hasUrl: !!doc.fileUrl,
            name: doc.originalFileName,
            createdAt: doc.createdAt,
          });
        }
      }
    }

    // Linked active clients always get a row. Without this, a client whose
    // documents never arrived (or are parked in inbound review) silently
    // vanishes from the screen instead of showing as "missing" — the
    // HAAT/Mishloha × Vini/Natanzon incident of June 2026.
    const linkedClients = await database
      .select({ clientId: clientFranchisee.clientId })
      .from(clientFranchisee)
      .innerJoin(client, eq(clientFranchisee.clientId, client.id))
      .where(
        and(
          eq(clientFranchisee.franchiseeId, franchiseeId),
          eq(client.isActive, true)
        )
      );

    // Collect all client IDs (documents from both sides + linked clients)
    const allClientIds = new Set([
      ...clientReports.keys(),
      ...tabitReports.keys(),
      ...linkedClients.map((l) => l.clientId),
    ]);

    if (allClientIds.size === 0) {
      return NextResponse.json({
        franchiseeName: fr.name,
        rows: [],
        summary: { total: 0, ok: 0, mismatch: 0, missing: 0 },
      });
    }

    // Load client names
    const clients = await database
      .select({ id: client.id, name: client.name, code: client.code })
      .from(client);

    const clientMap = new Map(clients.map((c) => [c.id, c]));

    // Build comparison rows
    const rows: ByFranchiseeRow[] = [];

    for (const clientId of allClientIds) {
      const c = clientMap.get(clientId);
      if (!c) continue;

      const clientAmt = clientReports.has(clientId)
        ? clientReports.get(clientId)!
        : null;
      const tabitAmt = tabitReports.has(clientId)
        ? tabitReports.get(clientId)!
        : null;

      let difference: number | null = null;
      let absoluteDifference: number | null = null;
      let status: ByFranchiseeRow["status"];

      if (clientAmt !== null && tabitAmt !== null) {
        difference = clientAmt - tabitAmt;
        absoluteDifference = Math.abs(difference);
        status = absoluteDifference <= THRESHOLD ? "ok" : "mismatch";
      } else if (c.code === "GIFTCARD" && tabitAmt !== null) {
        // Gift Card: Tabit is the sole source of truth — auto-approve
        difference = 0;
        absoluteDifference = 0;
        status = "ok";
      } else if (clientAmt !== null) {
        status = "missing_tabit";
      } else if (tabitAmt !== null) {
        status = "missing_client";
      } else {
        status = "missing_both";
      }

      const cf = latestClientFile.get(clientId);
      const tf = latestTabitFile.get(clientId);
      const inv = latestInvoiceFile.get(clientId);

      rows.push({
        clientId,
        clientName: c.name,
        clientCode: c.code,
        // Gift Card: use Tabit amount as client amount
        clientAmount: clientAmt ?? (c.code === "GIFTCARD" ? tabitAmt : null),
        tabitAmount: tabitAmt,
        clientFileDocId: cf?.hasUrl ? cf.docId : null,
        clientFileName: cf?.name ?? null,
        tabitFileDocId: tf?.hasUrl ? tf.docId : null,
        tabitFileName: tf?.name ?? null,
        invoiceFileDocId: inv?.hasUrl ? inv.docId : null,
        invoiceFileName: inv?.name ?? null,
        invoiceAmount: invoiceAmounts.get(clientId) ?? null,
        difference,
        absoluteDifference,
        status,
        approvedAt: null,
        approvedBy: null,
        approvedByName: null,
        approvalNotes: null,
      });
    }

    // Hydrate approval state
    const approvals = await getApprovalsByFranchisee(
      franchiseeId,
      periodMonth,
      periodYear
    );
    for (const r of rows) {
      const a = approvals.get(r.clientId);
      if (!a) continue;
      // Note-only rows have approvedBy = null; only mark as approved when set.
      if (a.approvedBy !== null) {
        r.approvedAt = a.approvedAt.toISOString();
        r.approvedBy = a.approvedBy;
        r.approvedByName = a.approvedByName;
      }
      r.approvalNotes = a.notes;
    }

    // Sort: mismatches first, then ok, then missing
    const statusOrder = { mismatch: 0, missing_client: 1, missing_tabit: 1, missing_both: 2, ok: 3 };
    rows.sort((a, b) => statusOrder[a.status] - statusOrder[b.status]);

    const approvedCount = rows.filter((r) => r.approvedAt !== null).length;
    const summary = {
      total: rows.length,
      ok: rows.filter((r) => r.status === "ok").length,
      mismatch: rows.filter((r) => r.status === "mismatch").length,
      missing: rows.filter((r) => r.status.startsWith("missing")).length,
      approved: approvedCount,
    };

    return NextResponse.json({
      franchiseeName: fr.name,
      rows,
      summary,
    });
  } catch (error) {
    console.error("Error fetching reconciliation by franchisee:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת נתוני התאמה" },
      { status: 500 }
    );
  }
}
