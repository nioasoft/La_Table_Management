import { database } from "@/db";
import {
  occasionalClient,
  occasionalClientDocument,
  type OccasionalClient,
  type UpdateOccasionalClientData,
} from "@/db/schema";
import { and, asc, desc, eq, sql } from "drizzle-orm";

/**
 * Canonical matching key for an occasional client — used to dedupe column
 * names across case/whitespace variants (Tabit headers are inconsistent).
 */
export function makeOccasionalClientKey(tabitColumnName: string): string {
  return tabitColumnName.trim().toLowerCase();
}

export interface ListOccasionalClientsOptions {
  includeIgnored?: boolean;
}

/**
 * List occasional clients, ordered by first-seen descending (newest first).
 * By default excludes ignored rows — pass `includeIgnored: true` to see all.
 */
export async function listOccasionalClients(
  options: ListOccasionalClientsOptions = {}
): Promise<OccasionalClient[]> {
  const { includeIgnored = false } = options;

  const query = database
    .select()
    .from(occasionalClient)
    .orderBy(
      asc(occasionalClient.ignored),
      desc(occasionalClient.firstSeenAt),
      asc(occasionalClient.tabitColumnName)
    );

  if (includeIgnored) {
    return query;
  }
  return query.where(eq(occasionalClient.ignored, false));
}

/**
 * Partial update of an occasional client — editable fields only.
 */
export async function updateOccasionalClient(
  id: string,
  patch: UpdateOccasionalClientData
): Promise<OccasionalClient | null> {
  const [updated] = await database
    .update(occasionalClient)
    .set({
      ...patch,
      updatedAt: new Date(),
    })
    .where(eq(occasionalClient.id, id))
    .returning();
  return updated ?? null;
}

/**
 * Upsert an occasional client by its matching key. Returns the current row
 * (the inserted one if new, or the existing one if already present).
 *
 * Used during Tabit ingestion when an unmapped column name is encountered.
 */
export async function upsertOccasionalClientFromTabit(input: {
  tabitColumnName: string;
  firstSeenPeriodMonth: number;
  firstSeenPeriodYear: number;
  createdBy?: string | null;
}): Promise<OccasionalClient> {
  const key = makeOccasionalClientKey(input.tabitColumnName);
  const trimmedName = input.tabitColumnName.trim();

  await database
    .insert(occasionalClient)
    .values({
      tabitColumnName: trimmedName,
      tabitColumnKey: key,
      firstSeenPeriodMonth: input.firstSeenPeriodMonth,
      firstSeenPeriodYear: input.firstSeenPeriodYear,
      createdBy: input.createdBy ?? null,
    })
    .onConflictDoNothing({ target: occasionalClient.tabitColumnKey });

  const [row] = await database
    .select()
    .from(occasionalClient)
    .where(eq(occasionalClient.tabitColumnKey, key))
    .limit(1);

  if (!row) {
    throw new Error(
      `Failed to upsert occasional client for key "${key}"`
    );
  }
  return row;
}

/**
 * Upsert an occasional-client transaction row for a (franchisee, period).
 * Overwrites totalAmount on conflict (re-upload scenario).
 */
export async function upsertOccasionalClientDocument(input: {
  occasionalClientId: string;
  franchiseeId: string;
  periodMonth: number;
  periodYear: number;
  totalAmount: number;
  sourceTabitFileUrl?: string | null;
  sourceTabitFileName?: string | null;
}): Promise<void> {
  await database
    .insert(occasionalClientDocument)
    .values({
      occasionalClientId: input.occasionalClientId,
      franchiseeId: input.franchiseeId,
      periodMonth: input.periodMonth,
      periodYear: input.periodYear,
      totalAmount: input.totalAmount.toString(),
      sourceTabitFileUrl: input.sourceTabitFileUrl ?? null,
      sourceTabitFileName: input.sourceTabitFileName ?? null,
    })
    .onConflictDoUpdate({
      target: [
        occasionalClientDocument.occasionalClientId,
        occasionalClientDocument.franchiseeId,
        occasionalClientDocument.periodMonth,
        occasionalClientDocument.periodYear,
      ],
      set: {
        totalAmount: input.totalAmount.toString(),
        sourceTabitFileUrl: input.sourceTabitFileUrl ?? null,
        sourceTabitFileName: input.sourceTabitFileName ?? null,
        updatedAt: new Date(),
      },
    });
}

export interface OccasionalClientExportRow {
  occasionalClientId: string;
  tabitColumnName: string;
  hashavshevetCode: string | null;
  hashavshevetName: string | null;
  totalAmount: number;
}

/**
 * Rows to merge into the client-invoices Hashavshevet export for a given
 * (franchisee, period). Excludes ignored rows and zero-amount rows.
 */
export async function getOccasionalClientsForExport(input: {
  franchiseeId: string;
  periodMonth: number;
  periodYear: number;
}): Promise<OccasionalClientExportRow[]> {
  const rows = await database
    .select({
      occasionalClientId: occasionalClient.id,
      tabitColumnName: occasionalClient.tabitColumnName,
      hashavshevetCode: occasionalClient.hashavshevetCode,
      hashavshevetName: occasionalClient.hashavshevetName,
      totalAmount: occasionalClientDocument.totalAmount,
    })
    .from(occasionalClientDocument)
    .innerJoin(
      occasionalClient,
      eq(occasionalClientDocument.occasionalClientId, occasionalClient.id)
    )
    .where(
      and(
        eq(occasionalClientDocument.franchiseeId, input.franchiseeId),
        eq(occasionalClientDocument.periodMonth, input.periodMonth),
        eq(occasionalClientDocument.periodYear, input.periodYear),
        eq(occasionalClient.ignored, false),
        sql`${occasionalClientDocument.totalAmount} <> 0`
      )
    )
    .orderBy(asc(occasionalClient.tabitColumnName));

  return rows.map((r) => ({
    occasionalClientId: r.occasionalClientId,
    tabitColumnName: r.tabitColumnName,
    hashavshevetCode: r.hashavshevetCode,
    hashavshevetName: r.hashavshevetName,
    totalAmount: parseFloat(r.totalAmount),
  }));
}
