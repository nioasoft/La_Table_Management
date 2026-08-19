/**
 * Document Archive — one flat, searchable list of every file that reached the
 * system, with a download link for each.
 *
 * Two sources, deliberately unioned instead of joined:
 *   1. `client_document`      — files that WERE filed (saved).
 *   2. `inbound_review_queue` — inbound emails whose attachment never became a
 *                               document (blocked by the overwrite guard,
 *                               rejected, unparsable, or still waiting).
 *
 * Source 2 is the whole point: "the report didn't arrive" is almost always
 * "the file arrived and we dropped it" (10bis 04/2026 sent one invoice per
 * restaurant under one ח.פ — the second overwrote the first and the real one
 * is only in the queue). Without it Reut cannot see, let alone download, the
 * file we refused.
 */
import { database } from "@/db";
import {
  client,
  clientDocument,
  franchisee,
  inboundReviewQueue,
} from "@/db/schema";
import { and, desc, eq, gte, lte, or, ilike, sql, type SQL } from "drizzle-orm";

export interface DocumentArchiveFilters {
  clientId?: string;
  franchiseeId?: string;
  periodMonth?: number;
  periodYear?: number;
  /** "saved" = filed documents, "blocked" = arrived but never filed. */
  kind?: "saved" | "blocked";
  /** Free text over file name, email subject and invoice number. */
  search?: string;
  /** Earliest receive date. */
  since?: Date;
  /** Latest receive date. */
  until?: Date;
  /** Max rows per source (default 200, hard cap 1000). */
  limit?: number;
}

export interface DocumentArchiveRow {
  id: string;
  kind: "saved" | "blocked";
  receivedAt: Date;
  clientName: string | null;
  franchiseeName: string | null;
  documentType: string | null;
  periodMonth: number | null;
  periodYear: number | null;
  fileName: string;
  emailSubject: string | null;
  invoiceNumber: string | null;
  totalAmount: string | null;
  status: string;
  /** Why it was not filed — only ever set on blocked rows. */
  statusReason: string | null;
  downloadUrl: string | null;
}

/**
 * Inbound attachments are stored under their percent-encoded name, so a Hebrew
 * file reads as "%D7%A0%D7%AA...pdf" in the queue. Decode for display; a name
 * that is not valid percent-encoding is left alone.
 */
function decodeFileName(name: string): string {
  try {
    return decodeURIComponent(name.replace(/\+/g, " "));
  } catch {
    return name;
  }
}

export async function listDocumentArchive(
  filters: DocumentArchiveFilters = {},
): Promise<DocumentArchiveRow[]> {
  const limit = Math.min(filters.limit ?? 200, 1000);
  const search = filters.search?.trim();
  const like = search ? `%${search}%` : undefined;

  const savedConditions: SQL[] = [];
  if (filters.clientId) savedConditions.push(eq(clientDocument.clientId, filters.clientId));
  if (filters.franchiseeId)
    savedConditions.push(eq(clientDocument.franchiseeId, filters.franchiseeId));
  if (filters.periodMonth !== undefined)
    savedConditions.push(eq(clientDocument.periodMonth, filters.periodMonth));
  if (filters.periodYear !== undefined)
    savedConditions.push(eq(clientDocument.periodYear, filters.periodYear));
  if (filters.since) savedConditions.push(gte(clientDocument.createdAt, filters.since));
  if (filters.until) savedConditions.push(lte(clientDocument.createdAt, filters.until));
  if (like) {
    savedConditions.push(
      or(
        ilike(clientDocument.originalFileName, like),
        ilike(clientDocument.invoiceNumber, like),
        ilike(franchisee.name, like),
      )!,
    );
  }

  const blockedConditions: SQL[] = [
    // Committed rows are already covered by client_document — listing them
    // again would double every file in the archive.
    sql`${inboundReviewQueue.committedClientDocumentId} is null`,
  ];
  if (filters.clientId) blockedConditions.push(eq(inboundReviewQueue.clientId, filters.clientId));
  if (filters.franchiseeId)
    blockedConditions.push(eq(inboundReviewQueue.proposedFranchiseeId, filters.franchiseeId));
  if (filters.periodMonth !== undefined)
    blockedConditions.push(eq(inboundReviewQueue.periodMonth, filters.periodMonth));
  if (filters.periodYear !== undefined)
    blockedConditions.push(eq(inboundReviewQueue.periodYear, filters.periodYear));
  // createdAt, not emailReceivedAt: the latter is nullable and a null would
  // silently drop the row from every date-filtered view.
  if (filters.since) blockedConditions.push(gte(inboundReviewQueue.createdAt, filters.since));
  if (filters.until) blockedConditions.push(lte(inboundReviewQueue.createdAt, filters.until));
  if (like) {
    blockedConditions.push(
      or(
        ilike(inboundReviewQueue.fileName, like),
        ilike(inboundReviewQueue.emailSubject, like),
        ilike(inboundReviewQueue.proposedFranchiseeName, like),
      )!,
    );
  }

  const wantSaved = filters.kind !== "blocked";
  const wantBlocked = filters.kind !== "saved";

  const [saved, blocked] = await Promise.all([
    wantSaved
      ? database
          .select({
            id: clientDocument.id,
            receivedAt: clientDocument.createdAt,
            clientName: client.name,
            franchiseeName: franchisee.name,
            documentType: clientDocument.documentType,
            periodMonth: clientDocument.periodMonth,
            periodYear: clientDocument.periodYear,
            fileName: clientDocument.originalFileName,
            invoiceNumber: clientDocument.invoiceNumber,
            totalAmount: clientDocument.totalAmount,
            status: clientDocument.processingStatus,
            source: clientDocument.source,
            fileUrl: clientDocument.fileUrl,
          })
          .from(clientDocument)
          .leftJoin(client, eq(clientDocument.clientId, client.id))
          .leftJoin(franchisee, eq(clientDocument.franchiseeId, franchisee.id))
          .where(savedConditions.length ? and(...savedConditions) : undefined)
          .orderBy(desc(clientDocument.createdAt))
          .limit(limit)
      : Promise.resolve([]),
    wantBlocked
      ? database
          .select({
            id: inboundReviewQueue.id,
            receivedAt: inboundReviewQueue.emailReceivedAt,
            createdAt: inboundReviewQueue.createdAt,
            clientName: client.name,
            clientCode: inboundReviewQueue.clientCode,
            franchiseeName: inboundReviewQueue.proposedFranchiseeName,
            documentType: inboundReviewQueue.proposedDocumentType,
            periodMonth: inboundReviewQueue.periodMonth,
            periodYear: inboundReviewQueue.periodYear,
            fileName: inboundReviewQueue.fileName,
            emailSubject: inboundReviewQueue.emailSubject,
            status: inboundReviewQueue.status,
            failureReason: inboundReviewQueue.failureReason,
            fileUrl: inboundReviewQueue.fileUrl,
          })
          .from(inboundReviewQueue)
          .leftJoin(client, eq(inboundReviewQueue.clientId, client.id))
          .where(and(...blockedConditions))
          .orderBy(desc(inboundReviewQueue.createdAt))
          .limit(limit)
      : Promise.resolve([]),
  ]);

  const rows: DocumentArchiveRow[] = [
    ...saved.map((r) => ({
      id: `doc:${r.id}`,
      kind: "saved" as const,
      receivedAt: r.receivedAt,
      clientName: r.clientName,
      franchiseeName: r.franchiseeName,
      documentType: r.documentType,
      periodMonth: r.periodMonth,
      periodYear: r.periodYear,
      fileName: decodeFileName(r.fileName),
      emailSubject: null,
      invoiceNumber: r.invoiceNumber,
      totalAmount: r.totalAmount,
      status: r.status,
      statusReason: null,
      // Auth-gated redirect, so the blob URL never leaves the server for
      // filed documents; queue rows fall back to their storage URL below.
      downloadUrl: r.fileUrl ? `/api/clients/documents/${r.id}/download` : null,
    })),
    ...blocked.map((r) => ({
      id: `queue:${r.id}`,
      kind: "blocked" as const,
      receivedAt: r.receivedAt ?? r.createdAt,
      clientName: r.clientName ?? r.clientCode,
      franchiseeName: r.franchiseeName,
      documentType: r.documentType,
      periodMonth: r.periodMonth,
      periodYear: r.periodYear,
      fileName: decodeFileName(r.fileName ?? "(ללא קובץ)"),
      emailSubject: r.emailSubject,
      invoiceNumber: null,
      totalAmount: null,
      status: r.status,
      statusReason: r.failureReason,
      downloadUrl: r.fileUrl,
    })),
  ];

  return rows.sort((a, b) => b.receivedAt.getTime() - a.receivedAt.getTime()).slice(0, limit);
}
