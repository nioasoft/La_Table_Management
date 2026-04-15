import { database } from "@/db";
import {
  client,
  clientDocument,
  occasionalClient,
  occasionalClientDocument,
  type OccasionalClient,
  type UpdateOccasionalClientData,
} from "@/db/schema";
import { and, asc, desc, eq, inArray, isNull, sql } from "drizzle-orm";

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
    hashavshevetName: r.hashavshevetName,
    totalAmount: parseFloat(r.totalAmount),
  }));
}

export interface OccasionalClientNeedingName {
  id: string;
  tabitColumnName: string;
  totalAmount: number;
}

/**
 * List occasional clients that appear in the Tabit data for a given
 * (franchisee, period) and still need a Hashavshevet name to be entered.
 * Excludes ignored rows and zero-amount documents.
 */
export async function listOccasionalClientsNeedingNames(input: {
  franchiseeId: string;
  periodMonth: number;
  periodYear: number;
}): Promise<OccasionalClientNeedingName[]> {
  const rows = await database
    .select({
      id: occasionalClient.id,
      tabitColumnName: occasionalClient.tabitColumnName,
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
        isNull(occasionalClient.hashavshevetName),
        sql`${occasionalClientDocument.totalAmount} <> 0`
      )
    )
    .orderBy(asc(occasionalClient.tabitColumnName));

  return rows.map((r) => ({
    id: r.id,
    tabitColumnName: r.tabitColumnName,
    totalAmount: parseFloat(r.totalAmount),
  }));
}

export interface MergeResult {
  occasionalClientId: string;
  clientId: string;
  documentsCreated: number;
  documentsUpdated: number;
}

/**
 * Merge an occasional client into an existing client.
 *
 * For every (franchisee, period) row in `occasional_client_document`, fold the
 * amount into the matching `client_document` of type `tabit_report`:
 *   - existing row → add `totalAmount` (sum with previously-mapped columns)
 *   - missing row  → create a new tabit_report row attributed to this client
 *
 * After the documents are folded in, the occasional_client itself is deleted
 * (cascading its occasional_client_document children).
 *
 * Idempotent if called twice — the second call no-ops because the occasional
 * is gone. Caller should not assume the row still exists after this returns.
 */
export async function mergeOccasionalIntoClient(
  occasionalId: string,
  clientId: string
): Promise<MergeResult> {
  const [occRow] = await database
    .select()
    .from(occasionalClient)
    .where(eq(occasionalClient.id, occasionalId))
    .limit(1);

  if (!occRow) {
    throw new Error(`Occasional client ${occasionalId} not found`);
  }

  const [clientRow] = await database
    .select({ id: client.id })
    .from(client)
    .where(eq(client.id, clientId))
    .limit(1);

  if (!clientRow) {
    throw new Error(`Client ${clientId} not found`);
  }

  const occDocs = await database
    .select()
    .from(occasionalClientDocument)
    .where(eq(occasionalClientDocument.occasionalClientId, occasionalId));

  let documentsCreated = 0;
  let documentsUpdated = 0;

  for (const od of occDocs) {
    const amount = parseFloat(od.totalAmount);

    const [existing] = await database
      .select({
        id: clientDocument.id,
        totalAmount: clientDocument.totalAmount,
      })
      .from(clientDocument)
      .where(
        and(
          eq(clientDocument.clientId, clientId),
          eq(clientDocument.franchiseeId, od.franchiseeId),
          eq(clientDocument.periodMonth, od.periodMonth),
          eq(clientDocument.periodYear, od.periodYear),
          eq(clientDocument.documentType, "tabit_report")
        )
      )
      .limit(1);

    if (existing) {
      const current = existing.totalAmount
        ? parseFloat(existing.totalAmount)
        : 0;
      await database
        .update(clientDocument)
        .set({
          totalAmount: (current + amount).toString(),
          updatedAt: new Date(),
        })
        .where(eq(clientDocument.id, existing.id));
      documentsUpdated++;
    } else {
      await database.insert(clientDocument).values({
        clientId,
        franchiseeId: od.franchiseeId,
        documentType: "tabit_report",
        source: "manual_upload",
        originalFileName:
          od.sourceTabitFileName ?? `Tabit (merged from "${occRow.tabitColumnName}")`,
        fileUrl: od.sourceTabitFileUrl,
        periodMonth: od.periodMonth,
        periodYear: od.periodYear,
        processingStatus: "auto_approved",
        totalAmount: amount.toString(),
        updatedAt: new Date(),
      });
      documentsCreated++;
    }
  }

  // Cascade deletes occasional_client_document rows.
  await database
    .delete(occasionalClient)
    .where(eq(occasionalClient.id, occasionalId));

  return {
    occasionalClientId: occasionalId,
    clientId,
    documentsCreated,
    documentsUpdated,
  };
}

/**
 * Find occasional clients (non-ignored) whose tabit_column_key matches any
 * of the given alias names. Used to drive auto-merge after a client edit
 * adds new aliases to its tabitColumnNames.
 */
export async function findOccasionalsByAliasNames(
  aliasNames: string[]
): Promise<OccasionalClient[]> {
  const keys = aliasNames
    .map((a) => makeOccasionalClientKey(a))
    .filter((k) => k.length > 0);
  if (keys.length === 0) return [];
  return database
    .select()
    .from(occasionalClient)
    .where(
      and(
        eq(occasionalClient.ignored, false),
        inArray(occasionalClient.tabitColumnKey, keys)
      )
    );
}
