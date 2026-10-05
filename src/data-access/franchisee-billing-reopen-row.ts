import { eq } from "drizzle-orm";
import type { NodePgDatabase } from "drizzle-orm/node-postgres";

import { createDeleteBillingLedgerQuery } from "@/data-access/franchisee-billing-screen-queries";
import * as schema from "@/db/schema";

export type ReopenBillingRowResult =
  | "reopened"
  | "not_found"
  | "not_approved"
  | "exported";

/**
 * Takes one approved royalty row back to draft so a forgotten discount or a
 * correction can be made, then the month is locked again. The amounts stay as
 * they are — only the approval comes off: the snapshots it froze and the
 * deferral-ledger entry it wrote. Leaving that entry would count the deferral
 * twice once the row is locked again. A row already in a Hashavshevet batch is
 * invoiced and stays locked.
 */
export async function reopenApprovedBillingRow(
  database: NodePgDatabase<typeof schema>,
  billingId: string,
): Promise<ReopenBillingRowResult> {
  const billing = schema.franchiseeBilling;
  return database.transaction(async (tx) => {
    const [row] = await tx
      .select({
        status: billing.status,
        royaltyExportedAt: billing.royaltyExportedAt,
        royaltyExportBatchId: billing.royaltyExportBatchId,
        marketingExportedAt: billing.marketingExportedAt,
        marketingExportBatchId: billing.marketingExportBatchId,
      })
      .from(billing)
      .where(eq(billing.id, billingId))
      .for("update");
    if (!row) return "not_found";
    if (row.status !== "approved") return "not_approved";
    if (
      row.royaltyExportedAt ||
      row.royaltyExportBatchId ||
      row.marketingExportedAt ||
      row.marketingExportBatchId
    ) {
      return "exported";
    }
    await tx
      .update(billing)
      .set({
        status: "draft",
        approvedAt: null,
        approvedBy: null,
        tiersSnapshot: null,
        tierBasisSnapshot: null,
        marketingRateSnapshot: null,
        vatRateSnapshot: null,
        accountKeySnapshot: null,
      })
      // The row is locked `for update` above, so the checks still hold.
      .where(eq(billing.id, billingId));
    await createDeleteBillingLedgerQuery(tx, billingId);
    return "reopened";
  });
}
