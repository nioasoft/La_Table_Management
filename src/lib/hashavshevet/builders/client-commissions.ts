import { database } from "@/db";
import { client } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getApprovedComparisonsForExport,
  getSessionWithComparisons,
} from "@/data-access/client-reconciliation";
import type { ResolvableClientAccount } from "@/lib/hashavshevet-account";

/**
 * Client commissions export ("עמלות לקוחות"): the row logic shared by the Excel
 * route (reports/hashavshevet/client-export) and the Hashavshevet API send path.
 * Queries moved out of the route verbatim; the Excel output must not change by a
 * single number.
 */

/** The Excel route's `exportType` query param: "invoice" (type 11) or "journal" (type 1). */
export type ClientCommissionsDocKind = "invoice" | "journal";

export interface ClientCommissionsParams {
  sessionId: string;
  docKind: ClientCommissionsDocKind;
}

export interface ClientCommissionsSession {
  clientId: string;
  clientName: string;
  periodMonth: number;
  periodYear: number;
}

/** What the export needs of the client: its LA TABLE code and the account-key inputs. */
export type ClientCommissionsClient = ResolvableClientAccount & { code: string | null };

export type ClientCommissionsComparison = Awaited<
  ReturnType<typeof getApprovedComparisonsForExport>
>[number];

/**
 * `session` / `client` are null when the lookup found nothing; the loader stops
 * reading at the first miss, exactly where the route used to answer 404.
 */
export interface ClientCommissionsData extends ClientCommissionsParams {
  session: ClientCommissionsSession | null;
  client: ClientCommissionsClient | null;
  /** Approved comparisons, ordered by franchisee name. */
  comparisons: ClientCommissionsComparison[];
}

/** All DB reads of the export. Read-only. */
export async function loadClientCommissionsData(
  params: ClientCommissionsParams
): Promise<ClientCommissionsData> {
  // Get session info for filename
  const sessionData = await getSessionWithComparisons(params.sessionId);
  if (!sessionData) return { ...params, session: null, client: null, comparisons: [] };

  const { session } = sessionData;

  // Get client's Hashavshevet account data (global + per-brand overrides)
  // and code (needed for the LA TABLE half-price invoice rule).
  const [clientRow] = await database
    .select({
      code: client.code,
      hashavshevetCode: client.hashavshevetCode,
      hashavshevetName: client.hashavshevetName,
      hashavshevetByBrand: client.hashavshevetByBrand,
      name: client.name,
    })
    .from(client)
    .where(eq(client.id, session.clientId))
    .limit(1);

  if (!clientRow) return { ...params, session, client: null, comparisons: [] };

  // Get approved comparisons
  const comparisons = await getApprovedComparisonsForExport(params.sessionId);
  return { ...params, session, client: clientRow, comparisons };
}
