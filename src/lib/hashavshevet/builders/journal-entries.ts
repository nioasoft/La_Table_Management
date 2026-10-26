import { database } from "@/db";
import { franchisee } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getApprovedForExport,
  type ExportRow,
} from "@/data-access/client-reconciliation-approval";

/**
 * Franchisee journal-entries export ("פקודות יומן"): the row logic shared by the
 * Excel route (reports/hashavshevet/franchisee-journal-entries-export) and the
 * Hashavshevet API send path. Queries moved out of the route verbatim; the Excel
 * output must not change by a single number.
 */

export interface JournalEntriesParams {
  franchiseeId: string;
  periodMonth: number;
  periodYear: number;
}

/** What the export needs of the franchisee: its name and the revenue-account override. */
export interface JournalEntriesFranchisee {
  name: string;
  hashavshevetRevenueAccount: string | null;
}

/**
 * `franchisee` is null when the lookup found nothing; the loader stops reading
 * there, exactly where the route used to answer 404.
 */
export interface JournalEntriesData extends JournalEntriesParams {
  franchisee: JournalEntriesFranchisee | null;
  /** Approved reconciliation rows (every client, before the journalEntryGeneration filter). */
  approved: ExportRow[];
}

/** All DB reads of the export. Read-only. */
export async function loadJournalEntriesData(
  params: JournalEntriesParams
): Promise<JournalEntriesData> {
  const { franchiseeId, periodMonth, periodYear } = params;
  const [fr] = await database
    .select({
      name: franchisee.name,
      hashavshevetRevenueAccount: franchisee.hashavshevetRevenueAccount,
    })
    .from(franchisee)
    .where(eq(franchisee.id, franchiseeId))
    .limit(1);

  if (!fr) return { ...params, franchisee: null, approved: [] };

  const approved = await getApprovedForExport({
    franchiseeId,
    periodMonth,
    periodYear,
  });

  return { ...params, franchisee: fr, approved };
}
