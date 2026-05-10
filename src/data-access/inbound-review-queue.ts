/**
 * Inbound Review Queue — data-access layer.
 *
 * Layer 2 of the inbound-pipeline overhaul (2026-05-10). One row per
 * inbound email processed by /api/clients/email-inbound; captures the
 * resolver's proposal + the outcome so the admin UI can answer Reut's
 * recurring question "did the email arrive?" without scraping
 * gmail_sync_log.error_details.
 *
 * Phase 2a (current): write-through — every inbound write is shadowed
 *                     here; no read gating.
 * Phase 2b (later):   gating — `needs_review` rows block client_document
 *                     creation until manually confirmed.
 */
import { database } from "@/db";
import {
  inboundReviewQueue,
  type CreateInboundReviewQueueData,
  type InboundReviewQueue,
  type InboundReviewStatus,
} from "@/db/schema";
import { and, desc, eq, gte, sql } from "drizzle-orm";

export async function createInboundReviewEntry(
  data: CreateInboundReviewQueueData,
): Promise<InboundReviewQueue> {
  const [row] = await database
    .insert(inboundReviewQueue)
    .values(data)
    .returning();
  return row;
}

export interface ListInboundReviewFilters {
  /** Restrict to a single status (default: all). */
  status?: InboundReviewStatus;
  /** Restrict to a single client_code (default: all). */
  clientCode?: string;
  /** Earliest createdAt to return (default: 7 days ago). */
  since?: Date;
  /** Maximum rows (default 100, hard cap 500). */
  limit?: number;
}

export async function listInboundReviewEntries(
  filters: ListInboundReviewFilters = {},
): Promise<InboundReviewQueue[]> {
  const limit = Math.min(filters.limit ?? 100, 500);
  const since =
    filters.since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);

  const conditions = [gte(inboundReviewQueue.createdAt, since)];
  if (filters.status) {
    conditions.push(eq(inboundReviewQueue.status, filters.status));
  }
  if (filters.clientCode) {
    conditions.push(eq(inboundReviewQueue.clientCode, filters.clientCode));
  }

  return database
    .select()
    .from(inboundReviewQueue)
    .where(and(...conditions))
    .orderBy(desc(inboundReviewQueue.createdAt))
    .limit(limit);
}

/**
 * Quick counts grouped by status for the admin dashboard header
 * ("12 arrived in last 7d: 10 auto-processed, 2 failed").
 */
export async function getInboundReviewStatusCounts(
  since?: Date,
): Promise<Record<string, number>> {
  const sinceDate = since ?? new Date(Date.now() - 7 * 24 * 60 * 60 * 1000);
  const rows = await database
    .select({
      status: inboundReviewQueue.status,
      count: sql<number>`count(*)::int`,
    })
    .from(inboundReviewQueue)
    .where(gte(inboundReviewQueue.createdAt, sinceDate))
    .groupBy(inboundReviewQueue.status);
  const out: Record<string, number> = {};
  for (const r of rows) out[r.status] = r.count;
  return out;
}
