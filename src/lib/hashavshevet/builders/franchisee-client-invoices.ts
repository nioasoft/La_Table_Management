import { database } from "@/db";
import { franchisee } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getApprovedForExport,
  type ExportRow,
} from "@/data-access/client-reconciliation-approval";
import {
  getOccasionalClientsForExport,
  type OccasionalClientExportRow,
} from "@/data-access/occasional-clients";

/**
 * Franchisee client-invoices export ("חשבוניות לקוחות של זכיין"): the row logic
 * shared by the Excel route (reports/hashavshevet/franchisee-client-invoices-export)
 * and the Hashavshevet API send path. Queries moved out of the route verbatim; the
 * Excel output must not change by a single number.
 */

export interface FranchiseeClientInvoicesParams {
  franchiseeId: string;
  periodMonth: number;
  periodYear: number;
}

/** What the export needs of the franchisee: its name and the item-key override. */
export interface FranchiseeClientInvoicesFranchisee {
  name: string;
  hashavshevetRevenueAccount: string | null;
}

/**
 * `franchisee` is null when the lookup found nothing; the loader stops reading
 * there, exactly where the route used to answer 404.
 */
export interface FranchiseeClientInvoicesData extends FranchiseeClientInvoicesParams {
  franchisee: FranchiseeClientInvoicesFranchisee | null;
  /** Approved reconciliation rows (every client, before the invoiceGeneration filter). */
  approved: ExportRow[];
  /** Occasional-client rows with a Hashavshevet name and a non-zero amount, ordered by column name. */
  occasional: OccasionalClientExportRow[];
}

/** All DB reads of the export. Read-only. */
export async function loadFranchiseeClientInvoicesData(
  params: FranchiseeClientInvoicesParams
): Promise<FranchiseeClientInvoicesData> {
  const { franchiseeId, periodMonth, periodYear } = params;
  const [fr] = await database
    .select({
      name: franchisee.name,
      hashavshevetRevenueAccount: franchisee.hashavshevetRevenueAccount,
    })
    .from(franchisee)
    .where(eq(franchisee.id, franchiseeId))
    .limit(1);

  if (!fr) return { ...params, franchisee: null, approved: [], occasional: [] };

  const approved = await getApprovedForExport({
    franchiseeId,
    periodMonth,
    periodYear,
  });

  // Fetch occasional-client rows for this franchisee+period. Already filters
  // out ignored rows and zero amounts in the data-access layer.
  const occasional = await getOccasionalClientsForExport({
    franchiseeId,
    periodMonth,
    periodYear,
  });

  return { ...params, franchisee: fr, approved, occasional };
}
