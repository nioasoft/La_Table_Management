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
  franchisee,
} from "@/db/schema";
import { and, eq, inArray, isNotNull, sql } from "drizzle-orm";
import {
  resolveClientHashavshevetAccount,
  type ResolvableClientAccount,
} from "@/lib/hashavshevet-account";

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
 * Returns per-client totals (client_report sum, tabit_report sum, net) for
 * rows in this franchisee+period that should be exported to Hashavshevet.
 *
 * A row qualifies for export when EITHER:
 *   1. It is manually approved (`client_reconciliation_approval.approvedBy` set), OR
 *   2. It is auto-approved (status="ok"): |client_amount - tabit_amount| <= ₪30, OR
 *   3. It is GIFTCARD with tabit-only data (Tabit is sole source of truth).
 *
 * Mirrors the status logic in `/api/clients/reconciliation/by-franchisee`,
 * so anything the UI shows with a green ✓ is included in the export.
 *
 * Used by the per-franchisee Hashavshevet exports
 * (client-invoices + journal-entries).
 */
export interface ExportRow {
  clientId: string;
  clientCode: string | null;
  clientName: string;
  hashavshevetCode: string | null;
  hashavshevetName: string | null;
  /**
   * Per-brand overrides for the Hashavshevet account name. Consumers should
   * usually prefer `accountKey` below, which already factors in the
   * franchisee's brand. Kept here for callers that need their own fallback
   * ordering (e.g. journal-entries export prefers name over code).
   */
  hashavshevetByBrand: Record<string, string> | null;
  /**
   * Brand of the franchisee this export was built for. Same for every row in
   * the array. Exposed so callers can resolve `hashavshevetByBrand` with a
   * different fallback order than `accountKey` uses.
   */
  franchiseeBrandId: string | null;
  /**
   * Pre-resolved Hashavshevet account key for the franchisee+brand this row
   * belongs to. Uses `hashavshevetByBrand[brandId]` when present, else falls
   * back to `hashavshevetCode || hashavshevetName || clientName`.
   * Export routes that want the standard code-first fallback should use this.
   */
  accountKey: string;
  invoiceGeneration: boolean;
  journalEntryGeneration: boolean;
  clientAmount: number;
  tabitAmount: number;
  netAmount: number | null;
  /** Last invoice number seen on the client_report documents for this client+period. */
  invoiceNumber: string | null;
  /**
   * Israeli tax allocation number (מספר הקצאה) — 9 digits.
   * Last value seen on the client_report documents for this client+period.
   * Null when no document carried one (invoices below the threshold are not
   * required to have an allocation number).
   */
  allocationNumber: string | null;
  approvedAt: Date;
}

const RECONCILIATION_THRESHOLD = 30; // NIS — same as by-franchisee endpoint

export async function getApprovedForExport(input: {
  franchiseeId: string;
  periodMonth: number;
  periodYear: number;
}): Promise<ExportRow[]> {
  const { franchiseeId, periodMonth, periodYear } = input;

  // 0. Load the franchisee's brand so we can resolve per-brand Hashavshevet
  //    overrides on the client records below.
  const [franchiseeRow] = await database
    .select({ brandId: franchisee.brandId })
    .from(franchisee)
    .where(eq(franchisee.id, franchiseeId))
    .limit(1);
  const franchiseeBrandId = franchiseeRow?.brandId ?? null;

  // 1. Manually-approved rows (with approvedBy set, note-only rows excluded).
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
        isNotNull(clientReconciliationApproval.approvedBy)
      )
    );

  const approvedAtByClient = new Map(
    approvals.map((a) => [a.clientId, a.approvedAt])
  );

  // 2. Aggregate ALL documents for this franchisee+period (we need every
  //    client to determine status, not just manually-approved ones).
  const docs = await database
    .select({
      clientId: clientDocument.clientId,
      documentType: clientDocument.documentType,
      totalAmount: clientDocument.totalAmount,
      netAmount: clientDocument.netAmount,
      invoiceNumber: clientDocument.invoiceNumber,
      allocationNumber: clientDocument.allocationNumber,
    })
    .from(clientDocument)
    .where(
      and(
        eq(clientDocument.franchiseeId, franchiseeId),
        eq(clientDocument.periodMonth, periodMonth),
        eq(clientDocument.periodYear, periodYear)
      )
    );

  const clientAmounts = new Map<string, number>();
  const tabitAmounts = new Map<string, number>();
  const netAmounts = new Map<string, number | null>();
  const invoiceNumbers = new Map<string, string>();
  const allocationNumbers = new Map<string, string>();

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
      // client_report's allocation number is preferred when present (it's the
      // outgoing tax invoice the franchisee issued to the client).
      if (d.allocationNumber) {
        allocationNumbers.set(d.clientId, d.allocationNumber);
      }
    } else if (d.documentType === "tabit_report") {
      tabitAmounts.set(d.clientId, (tabitAmounts.get(d.clientId) ?? 0) + total);
    } else if (d.documentType === "commission_invoice") {
      // Fallback source for allocation number: when the client_report is
      // missing one (typical for old uploads or below-threshold reports), the
      // commission invoice the franchisee received from the same client often
      // does carry one. Don't overwrite a client_report value.
      if (d.allocationNumber && !allocationNumbers.has(d.clientId)) {
        allocationNumbers.set(d.clientId, d.allocationNumber);
      }
    }
  }

  const clientIdsWithDocs = new Set<string>([
    ...clientAmounts.keys(),
    ...tabitAmounts.keys(),
  ]);

  // Union: any client with documents OR with a manual approval.
  const candidateIds = new Set<string>([
    ...clientIdsWithDocs,
    ...approvedAtByClient.keys(),
  ]);

  if (candidateIds.size === 0) return [];

  // 3. Fetch metadata for all candidate clients.
  const clients = await database
    .select({
      id: client.id,
      code: client.code,
      name: client.name,
      hashavshevetCode: client.hashavshevetCode,
      hashavshevetName: client.hashavshevetName,
      hashavshevetByBrand: client.hashavshevetByBrand,
      invoiceGeneration: client.invoiceGeneration,
      journalEntryGeneration: client.journalEntryGeneration,
    })
    .from(client)
    .where(inArray(client.id, Array.from(candidateIds)));

  // 4. Filter: keep only rows that qualify (manually approved OR status=ok).
  const result: ExportRow[] = [];

  for (const c of clients) {
    const clientAmt = clientAmounts.has(c.id) ? clientAmounts.get(c.id)! : null;
    const tabitAmt = tabitAmounts.has(c.id) ? tabitAmounts.get(c.id)! : null;
    const isManuallyApproved = approvedAtByClient.has(c.id);

    let isAutoOk = false;
    if (clientAmt !== null && tabitAmt !== null) {
      isAutoOk = Math.abs(clientAmt - tabitAmt) <= RECONCILIATION_THRESHOLD;
    } else if (c.code === "GIFTCARD" && tabitAmt !== null) {
      // Gift Card: Tabit is the sole source of truth.
      isAutoOk = true;
    }

    if (!isManuallyApproved && !isAutoOk) continue;

    // For GIFTCARD with tabit-only, surface the tabit amount as the
    // client amount (mirrors by-franchisee endpoint behavior).
    const exportClientAmount =
      clientAmt ?? (c.code === "GIFTCARD" ? (tabitAmt ?? 0) : 0);

    const resolvable: ResolvableClientAccount = {
      hashavshevetByBrand: c.hashavshevetByBrand,
      hashavshevetCode: c.hashavshevetCode,
      hashavshevetName: c.hashavshevetName,
      name: c.name,
    };

    result.push({
      clientId: c.id,
      clientCode: c.code,
      clientName: c.name,
      hashavshevetCode: c.hashavshevetCode,
      hashavshevetName: c.hashavshevetName,
      hashavshevetByBrand: c.hashavshevetByBrand ?? null,
      franchiseeBrandId,
      accountKey: resolveClientHashavshevetAccount(
        resolvable,
        franchiseeBrandId
      ),
      invoiceGeneration: c.invoiceGeneration,
      journalEntryGeneration: c.journalEntryGeneration,
      clientAmount: exportClientAmount,
      tabitAmount: tabitAmt ?? 0,
      netAmount: netAmounts.get(c.id) ?? null,
      invoiceNumber: invoiceNumbers.get(c.id) ?? null,
      allocationNumber: allocationNumbers.get(c.id) ?? null,
      approvedAt: approvedAtByClient.get(c.id) ?? new Date(),
    });
  }

  return result;
}
