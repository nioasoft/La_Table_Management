/**
 * Data access for client_reconciliation_approval.
 *
 * Persists per-(client, franchisee, period) approvals for the by-franchisee
 * reconciliation view. Unlike `clientReconciliationComparison` (which is tied
 * to a session), these approvals reference the computed by-franchisee grid
 * directly — Reut can mark any mismatch row as "approved despite discrepancy".
 */

import { database } from "@/db";
import {
  clientReconciliationApproval,
  user,
  client,
  clientDocument,
} from "@/db/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";

export interface ApprovalIdentifier {
  clientId: string;
  franchiseeId: string;
  periodMonth: number;
  periodYear: number;
}

export interface ApproveInput extends ApprovalIdentifier {
  approvedBy: string;
  notes?: string;
}

export interface ApprovalRow {
  clientId: string;
  franchiseeId: string;
  periodMonth: number;
  periodYear: number;
  /** null for note-only rows (no approval yet). */
  approvedBy: string | null;
  approvedByName: string | null;
  approvedAt: Date;
  notes: string | null;
}

/**
 * Approve a reconciliation row (upsert on unique constraint).
 * Re-approving refreshes approvedBy / approvedAt / notes.
 */
export async function approveReconciliation(
  input: ApproveInput
): Promise<void> {
  await database
    .insert(clientReconciliationApproval)
    .values({
      clientId: input.clientId,
      franchiseeId: input.franchiseeId,
      periodMonth: input.periodMonth,
      periodYear: input.periodYear,
      approvedBy: input.approvedBy,
      notes: input.notes ?? null,
    })
    .onConflictDoUpdate({
      target: [
        clientReconciliationApproval.clientId,
        clientReconciliationApproval.franchiseeId,
        clientReconciliationApproval.periodMonth,
        clientReconciliationApproval.periodYear,
      ],
      set: {
        approvedBy: input.approvedBy,
        approvedAt: new Date(),
        notes: input.notes ?? null,
      },
    });
}

/**
 * Remove an approval (unmark). Preserves the `notes` field if set — only
 * clears the approval-specific columns. If no note exists, the row is deleted
 * entirely. No-op if the row doesn't exist.
 */
export async function unapproveReconciliation(
  id: ApprovalIdentifier
): Promise<void> {
  const [existing] = await database
    .select({ notes: clientReconciliationApproval.notes })
    .from(clientReconciliationApproval)
    .where(
      and(
        eq(clientReconciliationApproval.clientId, id.clientId),
        eq(clientReconciliationApproval.franchiseeId, id.franchiseeId),
        eq(clientReconciliationApproval.periodMonth, id.periodMonth),
        eq(clientReconciliationApproval.periodYear, id.periodYear)
      )
    )
    .limit(1);

  if (!existing) return;

  if (existing.notes && existing.notes.trim().length > 0) {
    // Keep the row for the note; just clear approval state.
    await database
      .update(clientReconciliationApproval)
      .set({ approvedBy: null })
      .where(
        and(
          eq(clientReconciliationApproval.clientId, id.clientId),
          eq(clientReconciliationApproval.franchiseeId, id.franchiseeId),
          eq(clientReconciliationApproval.periodMonth, id.periodMonth),
          eq(clientReconciliationApproval.periodYear, id.periodYear)
        )
      );
    return;
  }

  await database
    .delete(clientReconciliationApproval)
    .where(
      and(
        eq(clientReconciliationApproval.clientId, id.clientId),
        eq(clientReconciliationApproval.franchiseeId, id.franchiseeId),
        eq(clientReconciliationApproval.periodMonth, id.periodMonth),
        eq(clientReconciliationApproval.periodYear, id.periodYear)
      )
    );
}

/**
 * Upsert a per-row note independent of approval state.
 * - If a row exists (approved or not): updates the `notes` column only.
 * - If no row exists: inserts a note-only row (approvedBy null).
 * Passing an empty/null note clears the note. If the row has no approval
 * either, the row is deleted.
 */
export async function upsertReconciliationNote(input: {
  clientId: string;
  franchiseeId: string;
  periodMonth: number;
  periodYear: number;
  note: string | null;
}): Promise<void> {
  const trimmed = input.note?.trim() ?? "";
  const noteValue = trimmed.length > 0 ? trimmed : null;

  if (noteValue === null) {
    // Clearing the note — read existing approval state to decide.
    const [existing] = await database
      .select({ approvedBy: clientReconciliationApproval.approvedBy })
      .from(clientReconciliationApproval)
      .where(
        and(
          eq(clientReconciliationApproval.clientId, input.clientId),
          eq(clientReconciliationApproval.franchiseeId, input.franchiseeId),
          eq(clientReconciliationApproval.periodMonth, input.periodMonth),
          eq(clientReconciliationApproval.periodYear, input.periodYear)
        )
      )
      .limit(1);

    if (!existing) return;

    if (existing.approvedBy === null) {
      await database
        .delete(clientReconciliationApproval)
        .where(
          and(
            eq(clientReconciliationApproval.clientId, input.clientId),
            eq(clientReconciliationApproval.franchiseeId, input.franchiseeId),
            eq(clientReconciliationApproval.periodMonth, input.periodMonth),
            eq(clientReconciliationApproval.periodYear, input.periodYear)
          )
        );
    } else {
      await database
        .update(clientReconciliationApproval)
        .set({ notes: null })
        .where(
          and(
            eq(clientReconciliationApproval.clientId, input.clientId),
            eq(clientReconciliationApproval.franchiseeId, input.franchiseeId),
            eq(clientReconciliationApproval.periodMonth, input.periodMonth),
            eq(clientReconciliationApproval.periodYear, input.periodYear)
          )
        );
    }
    return;
  }

  await database
    .insert(clientReconciliationApproval)
    .values({
      clientId: input.clientId,
      franchiseeId: input.franchiseeId,
      periodMonth: input.periodMonth,
      periodYear: input.periodYear,
      approvedBy: null,
      notes: noteValue,
    })
    .onConflictDoUpdate({
      target: [
        clientReconciliationApproval.clientId,
        clientReconciliationApproval.franchiseeId,
        clientReconciliationApproval.periodMonth,
        clientReconciliationApproval.periodYear,
      ],
      set: { notes: noteValue },
    });
}

/** Bulk-approve many client IDs for the same franchisee+period. */
export async function batchApproveForFranchisee(input: {
  franchiseeId: string;
  periodMonth: number;
  periodYear: number;
  approvedBy: string;
  clientIds: string[];
}): Promise<number> {
  if (input.clientIds.length === 0) return 0;

  const rows = input.clientIds.map((clientId) => ({
    clientId,
    franchiseeId: input.franchiseeId,
    periodMonth: input.periodMonth,
    periodYear: input.periodYear,
    approvedBy: input.approvedBy,
    notes: null as string | null,
  }));

  await database
    .insert(clientReconciliationApproval)
    .values(rows)
    .onConflictDoUpdate({
      target: [
        clientReconciliationApproval.clientId,
        clientReconciliationApproval.franchiseeId,
        clientReconciliationApproval.periodMonth,
        clientReconciliationApproval.periodYear,
      ],
      set: {
        approvedBy: sql`EXCLUDED.approved_by`,
        approvedAt: sql`now()`,
      },
    });

  return input.clientIds.length;
}

/** Get all approvals for a franchisee+period — keyed by clientId. */
export async function getApprovalsByFranchisee(
  franchiseeId: string,
  periodMonth: number,
  periodYear: number
): Promise<Map<string, ApprovalRow>> {
  const rows = await database
    .select({
      clientId: clientReconciliationApproval.clientId,
      franchiseeId: clientReconciliationApproval.franchiseeId,
      periodMonth: clientReconciliationApproval.periodMonth,
      periodYear: clientReconciliationApproval.periodYear,
      approvedBy: clientReconciliationApproval.approvedBy,
      approvedByName: user.name,
      approvedAt: clientReconciliationApproval.approvedAt,
      notes: clientReconciliationApproval.notes,
    })
    .from(clientReconciliationApproval)
    .leftJoin(user, eq(clientReconciliationApproval.approvedBy, user.id))
    .where(
      and(
        eq(clientReconciliationApproval.franchiseeId, franchiseeId),
        eq(clientReconciliationApproval.periodMonth, periodMonth),
        eq(clientReconciliationApproval.periodYear, periodYear)
      )
    );

  const map = new Map<string, ApprovalRow>();
  for (const r of rows) {
    map.set(r.clientId, r);
  }
  return map;
}

/**
 * Aggregate approved reconciliation rows for export.
 * Returns per-client totals (client_report sum, tabit_report sum, net) for the
 * approved rows in this franchisee+period.
 *
 * Used by the per-franchisee Hashavshevet export.
 */
export interface ExportRow {
  clientId: string;
  clientCode: string | null;
  clientName: string;
  hashavshevetCode: string | null;
  hashavshevetName: string | null;
  invoiceGeneration: boolean;
  journalEntryGeneration: boolean;
  clientAmount: number;
  tabitAmount: number;
  netAmount: number | null;
  /** Last invoice number seen on the client_report documents for this client+period. */
  invoiceNumber: string | null;
  approvedAt: Date;
}

export async function getApprovedForExport(input: {
  franchiseeId: string;
  periodMonth: number;
  periodYear: number;
}): Promise<ExportRow[]> {
  const { franchiseeId, periodMonth, periodYear } = input;

  const approvals = await database
    .select({
      clientId: clientReconciliationApproval.clientId,
      approvedAt: clientReconciliationApproval.approvedAt,
    })
    .from(clientReconciliationApproval)
    .where(
      and(
        eq(clientReconciliationApproval.franchiseeId, franchiseeId),
        eq(clientReconciliationApproval.periodMonth, periodMonth),
        eq(clientReconciliationApproval.periodYear, periodYear),
        // Only true approvals (rows with approvedBy set) are exported.
        // Note-only rows (approvedBy = null) are excluded.
        isNotNull(clientReconciliationApproval.approvedBy)
      )
    );

  if (approvals.length === 0) return [];

  const approvedClientIds = approvals.map((a) => a.clientId);
  const approvedAtByClient = new Map(
    approvals.map((a) => [a.clientId, a.approvedAt])
  );

  // Fetch client metadata
  const clients = await database
    .select({
      id: client.id,
      code: client.code,
      name: client.name,
      hashavshevetCode: client.hashavshevetCode,
      hashavshevetName: client.hashavshevetName,
      invoiceGeneration: client.invoiceGeneration,
      journalEntryGeneration: client.journalEntryGeneration,
    })
    .from(client)
    .where(inArray(client.id, approvedClientIds));

  // Aggregate document totals (client_report + tabit_report + netAmount) per client
  const docs = await database
    .select({
      clientId: clientDocument.clientId,
      documentType: clientDocument.documentType,
      totalAmount: clientDocument.totalAmount,
      netAmount: clientDocument.netAmount,
      invoiceNumber: clientDocument.invoiceNumber,
    })
    .from(clientDocument)
    .where(
      and(
        eq(clientDocument.franchiseeId, franchiseeId),
        eq(clientDocument.periodMonth, periodMonth),
        eq(clientDocument.periodYear, periodYear),
        inArray(clientDocument.clientId, approvedClientIds)
      )
    );

  const clientAmounts = new Map<string, number>();
  const tabitAmounts = new Map<string, number>();
  const netAmounts = new Map<string, number | null>();
  const invoiceNumbers = new Map<string, string>();

  for (const d of docs) {
    if (!d.clientId) continue;
    const total = d.totalAmount ? parseFloat(d.totalAmount) : 0;
    const net = d.netAmount ? parseFloat(d.netAmount) : null;

    if (d.documentType === "client_report") {
      clientAmounts.set(d.clientId, (clientAmounts.get(d.clientId) ?? 0) + total);
      if (net !== null) {
        netAmounts.set(d.clientId, (netAmounts.get(d.clientId) ?? 0) + net);
      }
      if (d.invoiceNumber) {
        invoiceNumbers.set(d.clientId, d.invoiceNumber);
      }
    } else if (d.documentType === "tabit_report") {
      tabitAmounts.set(d.clientId, (tabitAmounts.get(d.clientId) ?? 0) + total);
    }
  }

  return clients.map((c) => ({
    clientId: c.id,
    clientCode: c.code,
    clientName: c.name,
    hashavshevetCode: c.hashavshevetCode,
    hashavshevetName: c.hashavshevetName,
    invoiceGeneration: c.invoiceGeneration,
    journalEntryGeneration: c.journalEntryGeneration,
    clientAmount: clientAmounts.get(c.id) ?? 0,
    tabitAmount: tabitAmounts.get(c.id) ?? 0,
    netAmount: netAmounts.get(c.id) ?? null,
    invoiceNumber: invoiceNumbers.get(c.id) ?? null,
    approvedAt: approvedAtByClient.get(c.id) ?? new Date(),
  }));
}
