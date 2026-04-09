/**
 * Data access layer for client documents.
 *
 * Handles CRUD operations for client_document table, including
 * document tracking matrix queries for the dashboard.
 */

import { database } from "@/db";
import {
  clientDocument,
  client,
  franchisee,
  clientFranchisee,
  type ClientDocument,
  type CreateClientDocumentData,
  type UpdateClientDocumentData,
  type ClientDocumentType,
  type ClientDocumentSource,
} from "@/db/schema";
import { eq, and, desc, sql, inArray } from "drizzle-orm";
import type { UploadedFileReviewStatus } from "@/db/schema";

/** Filters for querying client documents */
export interface ClientDocumentFilters {
  clientId?: string;
  franchiseeId?: string;
  documentType?: ClientDocumentType;
  source?: ClientDocumentSource;
  processingStatus?: UploadedFileReviewStatus;
  periodMonth?: number;
  periodYear?: number;
  limit?: number;
  offset?: number;
}

/** Client document with joined entity names */
export interface ClientDocumentWithDetails extends ClientDocument {
  clientName: string | null;
  franchiseeName: string;
}

/** Tracking matrix cell data */
export interface TrackingMatrixCell {
  clientId: string;
  franchiseeId: string;
  documentId: string | null;
  status: UploadedFileReviewStatus | "missing";
  totalAmount: string | null;
}

/** Tracking matrix row (one per franchisee) */
export interface TrackingMatrixRow {
  franchiseeId: string;
  franchiseeName: string;
  brandName: string | null;
  clients: Record<string, TrackingMatrixCell>;
  tabitStatus: UploadedFileReviewStatus | "missing";
  tabitDocumentId: string | null;
  tabitAmount: string | null;
}

/**
 * Get client documents with optional filters
 */
export async function getClientDocuments(
  filters: ClientDocumentFilters = {}
): Promise<ClientDocumentWithDetails[]> {
  const conditions = [];

  if (filters.clientId) {
    conditions.push(eq(clientDocument.clientId, filters.clientId));
  }
  if (filters.franchiseeId) {
    conditions.push(eq(clientDocument.franchiseeId, filters.franchiseeId));
  }
  if (filters.documentType) {
    conditions.push(eq(clientDocument.documentType, filters.documentType));
  }
  if (filters.source) {
    conditions.push(eq(clientDocument.source, filters.source));
  }
  if (filters.processingStatus) {
    conditions.push(eq(clientDocument.processingStatus, filters.processingStatus));
  }
  if (filters.periodMonth !== undefined) {
    conditions.push(eq(clientDocument.periodMonth, filters.periodMonth));
  }
  if (filters.periodYear !== undefined) {
    conditions.push(eq(clientDocument.periodYear, filters.periodYear));
  }

  const query = database
    .select({
      id: clientDocument.id,
      clientId: clientDocument.clientId,
      franchiseeId: clientDocument.franchiseeId,
      documentType: clientDocument.documentType,
      source: clientDocument.source,
      originalFileName: clientDocument.originalFileName,
      fileUrl: clientDocument.fileUrl,
      fileSize: clientDocument.fileSize,
      mimeType: clientDocument.mimeType,
      periodMonth: clientDocument.periodMonth,
      periodYear: clientDocument.periodYear,
      processingStatus: clientDocument.processingStatus,
      processingResult: clientDocument.processingResult,
      ocrResult: clientDocument.ocrResult,
      totalAmount: clientDocument.totalAmount,
      commissionAmount: clientDocument.commissionAmount,
      commissionRate: clientDocument.commissionRate,
      netAmount: clientDocument.netAmount,
      gmailMessageId: clientDocument.gmailMessageId,
      reviewedBy: clientDocument.reviewedBy,
      reviewedAt: clientDocument.reviewedAt,
      reviewNotes: clientDocument.reviewNotes,
      createdAt: clientDocument.createdAt,
      updatedAt: clientDocument.updatedAt,
      createdBy: clientDocument.createdBy,
      clientName: client.name,
      franchiseeName: franchisee.name,
    })
    .from(clientDocument)
    .leftJoin(client, eq(clientDocument.clientId, client.id))
    .innerJoin(franchisee, eq(clientDocument.franchiseeId, franchisee.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(clientDocument.createdAt));

  if (filters.limit) {
    return query.limit(filters.limit).offset(filters.offset ?? 0);
  }

  return query;
}

/**
 * Get a single client document by ID with details
 */
export async function getClientDocumentById(
  id: string
): Promise<ClientDocumentWithDetails | null> {
  const results = await database
    .select({
      id: clientDocument.id,
      clientId: clientDocument.clientId,
      franchiseeId: clientDocument.franchiseeId,
      documentType: clientDocument.documentType,
      source: clientDocument.source,
      originalFileName: clientDocument.originalFileName,
      fileUrl: clientDocument.fileUrl,
      fileSize: clientDocument.fileSize,
      mimeType: clientDocument.mimeType,
      periodMonth: clientDocument.periodMonth,
      periodYear: clientDocument.periodYear,
      processingStatus: clientDocument.processingStatus,
      processingResult: clientDocument.processingResult,
      ocrResult: clientDocument.ocrResult,
      totalAmount: clientDocument.totalAmount,
      commissionAmount: clientDocument.commissionAmount,
      commissionRate: clientDocument.commissionRate,
      netAmount: clientDocument.netAmount,
      gmailMessageId: clientDocument.gmailMessageId,
      reviewedBy: clientDocument.reviewedBy,
      reviewedAt: clientDocument.reviewedAt,
      reviewNotes: clientDocument.reviewNotes,
      createdAt: clientDocument.createdAt,
      updatedAt: clientDocument.updatedAt,
      createdBy: clientDocument.createdBy,
      clientName: client.name,
      franchiseeName: franchisee.name,
    })
    .from(clientDocument)
    .leftJoin(client, eq(clientDocument.clientId, client.id))
    .innerJoin(franchisee, eq(clientDocument.franchiseeId, franchisee.id))
    .where(eq(clientDocument.id, id))
    .limit(1);

  return results[0] ?? null;
}

/**
 * Update a client document
 */
export async function updateClientDocument(
  id: string,
  data: UpdateClientDocumentData
): Promise<ClientDocument> {
  const [updated] = await database
    .update(clientDocument)
    .set({ ...data, updatedAt: new Date() })
    .where(eq(clientDocument.id, id))
    .returning();
  return updated;
}

/**
 * Delete a client document
 */
export async function deleteClientDocument(id: string): Promise<void> {
  await database.delete(clientDocument).where(eq(clientDocument.id, id));
}

/**
 * Get document tracking matrix for a specific period.
 *
 * Returns a grid showing which franchisees have documents from which clients,
 * including Tabit reports. This powers the tracking dashboard.
 */
export async function getDocumentTrackingMatrix(
  periodMonth: number,
  periodYear: number,
  clientIds?: string[]
): Promise<TrackingMatrixRow[]> {
  // Get all active clients (or filtered subset)
  const clientConditions = [eq(client.isActive, true)];
  if (clientIds?.length) {
    clientConditions.push(inArray(client.id, clientIds));
  }

  const activeClients = await database
    .select({ id: client.id, name: client.name })
    .from(client)
    .where(and(...clientConditions));

  // Get all franchisees linked to these clients
  const clientIdList = activeClients.map((c) => c.id);
  if (clientIdList.length === 0) return [];

  const linkedFranchisees = await database
    .selectDistinct({
      franchiseeId: clientFranchisee.franchiseeId,
      franchiseeName: franchisee.name,
      brandId: franchisee.brandId,
    })
    .from(clientFranchisee)
    .innerJoin(franchisee, eq(clientFranchisee.franchiseeId, franchisee.id))
    .where(
      and(
        inArray(clientFranchisee.clientId, clientIdList),
        eq(franchisee.isActive, true)
      )
    );

  if (linkedFranchisees.length === 0) return [];

  const franchiseeIds = linkedFranchisees.map((f) => f.franchiseeId);

  // Get all documents for this period
  const docs = await database
    .select({
      id: clientDocument.id,
      clientId: clientDocument.clientId,
      franchiseeId: clientDocument.franchiseeId,
      documentType: clientDocument.documentType,
      processingStatus: clientDocument.processingStatus,
      totalAmount: clientDocument.totalAmount,
    })
    .from(clientDocument)
    .where(
      and(
        eq(clientDocument.periodMonth, periodMonth),
        eq(clientDocument.periodYear, periodYear),
        inArray(clientDocument.franchiseeId, franchiseeIds)
      )
    );

  // Build the matrix
  const docMap = new Map<string, typeof docs[0]>();
  // Track aggregated tabit data per franchisee (sum across all clients)
  const tabitByFranchisee = new Map<
    string,
    { totalAmount: number; count: number; status: string }
  >();

  for (const doc of docs) {
    if (doc.documentType === "tabit_report") {
      // Key per client for individual matching
      if (doc.clientId) {
        docMap.set(`${doc.clientId}:${doc.franchiseeId}:tabit`, doc);
      }
      // Aggregate for the Tabit summary column
      const existing = tabitByFranchisee.get(doc.franchiseeId);
      const amount = doc.totalAmount ? parseFloat(doc.totalAmount) : 0;
      if (existing) {
        existing.totalAmount += amount;
        existing.count++;
      } else {
        tabitByFranchisee.set(doc.franchiseeId, {
          totalAmount: amount,
          count: 1,
          status: doc.processingStatus ?? "pending",
        });
      }
    } else {
      docMap.set(`${doc.clientId}:${doc.franchiseeId}`, doc);
    }
  }

  // Get client-franchisee links
  const links = await database
    .select({
      clientId: clientFranchisee.clientId,
      franchiseeId: clientFranchisee.franchiseeId,
    })
    .from(clientFranchisee)
    .where(inArray(clientFranchisee.clientId, clientIdList));

  const linkSet = new Set(links.map((l) => `${l.clientId}:${l.franchiseeId}`));

  return linkedFranchisees.map((f) => {
    const clients: Record<string, TrackingMatrixCell> = {};

    for (const c of activeClients) {
      // Only include if this client is linked to this franchisee
      if (!linkSet.has(`${c.id}:${f.franchiseeId}`)) continue;

      // Only show client reports — Tabit data is for reconciliation, not tracking
      const doc = docMap.get(`${c.id}:${f.franchiseeId}`);
      clients[c.id] = {
        clientId: c.id,
        franchiseeId: f.franchiseeId,
        documentId: doc?.id ?? null,
        status: doc?.processingStatus ?? "missing",
        totalAmount: doc?.totalAmount ?? null,
      };
    }

    const tabitAgg = tabitByFranchisee.get(f.franchiseeId);

    return {
      franchiseeId: f.franchiseeId,
      franchiseeName: f.franchiseeName,
      brandName: null,
      clients,
      tabitStatus: tabitAgg ? "auto_approved" : "missing",
      tabitDocumentId: null,
      tabitAmount: tabitAgg ? tabitAgg.totalAmount.toString() : null,
    };
  });
}

/**
 * Get document counts summary for a period
 */
export async function getDocumentPeriodSummary(
  periodMonth: number,
  periodYear: number
): Promise<{
  totalDocuments: number;
  clientReports: number;
  tabitReports: number;
  pending: number;
  approved: number;
  needsReview: number;
}> {
  const result = await database
    .select({
      totalDocuments: sql<number>`count(*)`,
      clientReports: sql<number>`count(*) filter (where ${clientDocument.documentType} = 'client_report')`,
      tabitReports: sql<number>`count(*) filter (where ${clientDocument.documentType} = 'tabit_report')`,
      pending: sql<number>`count(*) filter (where ${clientDocument.processingStatus} = 'pending')`,
      approved: sql<number>`count(*) filter (where ${clientDocument.processingStatus} in ('approved', 'auto_approved'))`,
      needsReview: sql<number>`count(*) filter (where ${clientDocument.processingStatus} = 'needs_review')`,
    })
    .from(clientDocument)
    .where(
      and(
        eq(clientDocument.periodMonth, periodMonth),
        eq(clientDocument.periodYear, periodYear)
      )
    );

  return result[0] ?? {
    totalDocuments: 0,
    clientReports: 0,
    tabitReports: 0,
    pending: 0,
    approved: 0,
    needsReview: 0,
  };
}
