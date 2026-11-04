import { database } from "@/db";
import { client } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getApprovedComparisonsForExport,
  getSessionWithComparisons,
} from "@/data-access/client-reconciliation";
import {
  resolveClientHashavshevetAccount,
  type ResolvableClientAccount,
} from "@/lib/hashavshevet-account";
import { clientCommissionsParams } from "@/schemas/hashavshevet";
import { copy, exportLabels } from "../copy";
import { apiDocumentId, apiMoney, apiQuantity, lastDayOfMonth } from "../format";
import type { ExportDefinition } from "../registry";
import type { ApiRow, BuiltRow } from "../types";

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

// ============================================================================
// ROWS (pure)
// ============================================================================

/** The eight Excel columns, in order. `display` keys match these. */
export const CLIENT_COMMISSIONS_HEADERS = [
  "מפתח חשבון",
  "שם",
  "מפתח פריט",
  "שם פריט",
  "כמות",
  "מחיר",
  "סוג המסמך",
  "מספר מסמך",
] as const;

/** Excel "סוג המסמך": 11 = invoice (חשבונית), 1 = journal entry (פקודת יומן). */
const DOCUMENT_TYPES: Record<ClientCommissionsDocKind, number> = { invoice: 11, journal: 1 };

export const SESSION_NOT_FOUND_MESSAGE = "התאמה לא נמצאה";
export const CLIENT_NOT_FOUND_MESSAGE = "לקוח לא נמצא";
export const NO_APPROVED_ROWS_MESSAGE = "אין שורות מאושרות לייצוא";
export const ALL_ZERO_MESSAGE = "אין סכומים לייצוא (כל הסכומים אפס)";

/** Why nothing can be exported: the Excel route answers with `status`, the API path blocks with `message`. */
export interface ClientCommissionsFailure {
  ok: false;
  status: 400 | 404;
  message: string;
}

export interface ClientCommissionsSheet {
  ok: true;
  session: ClientCommissionsSession;
  rows: BuiltRow[];
}

interface RowContext {
  clientId: string;
  client: ClientCommissionsClient;
  docKind: ClientCommissionsDocKind;
  periodStart: string;
  periodEnd: string;
  /** LA TABLE invoice rule: the invoice is for half the bookkeeping amount. */
  halve: boolean;
}

/** The comparison's net amount; empty counts as 0 (the zero test and the price share it). */
function netOf(comp: ClientCommissionsComparison): number {
  return comp.netAmount ? parseFloat(comp.netAmount) : 0;
}

/** YYYY-MM-DD bounds of the session month, from local date parts (never toISOString). */
function monthBounds(year: number, month: number): { start: string; end: string } {
  return { start: `${year}-${String(month).padStart(2, "0")}-01`, end: lastDayOfMonth(year, month) };
}

/**
 * LA TABLE special rule: on invoice exports only, the amount is halved (the
 * bookkeeping value is what Tabit shows, but the invoice we issue is for 50% of
 * it). Journal-entry exports keep the full amount.
 */
function isLaTableInvoice(client: ClientCommissionsClient, docKind: ClientCommissionsDocKind): boolean {
  return (client.code === "LATABLE" || client.code === "LATABLEMARK") && docKind === "invoice";
}

/**
 * The H-Connect row. A document type with no API equivalent (journal, spec §13 #1)
 * gets an empty row: the Excel never reads it, and buildClientCommissionsRows
 * blocks the API path, so it can never be sent.
 */
function apiRowOf(accountKey: string, itemKey: string, price: number, documentType: number): ApiRow {
  const documentId = apiDocumentId(documentType);
  if (documentId === null) return {};
  return {
    accountKey,
    itemkey: itemKey,
    Quantity: apiQuantity(1),
    price: apiMoney(price),
    DocumentID: documentId,
  };
}

function toBuiltRow(comp: ClientCommissionsComparison, ctx: RowContext): BuiltRow {
  const net = netOf(comp);
  const price = ctx.halve ? Math.round(net / 2) : Math.round(net);
  const accountKey = resolveClientHashavshevetAccount(ctx.client, comp.franchiseeBrandId);
  const itemKey = `עמלות ${comp.franchiseeName}`;
  const documentType = DOCUMENT_TYPES[ctx.docKind];
  const display: Record<(typeof CLIENT_COMMISSIONS_HEADERS)[number], string | number> = {
    "מפתח חשבון": accountKey,
    "שם": "",
    "מפתח פריט": itemKey,
    "שם פריט": "",
    "כמות": 1,
    "מחיר": price,
    "סוג המסמך": documentType,
    "מספר מסמך": "",
  };
  const rowKey = [ctx.clientId, comp.franchiseeId, ctx.periodStart, ctx.periodEnd, ctx.docKind].join("|");
  return {
    rowKey,
    companyId: comp.hashavshevetCompanyId,
    documentKey: rowKey,
    amount: price,
    display,
    apiRow: apiRowOf(accountKey, itemKey, price, documentType),
    periodEnd: ctx.periodEnd,
  };
}

/** The Excel file's rows, or the reason there are none. Independent of the API mapping, so the journal Excel always builds. */
export function buildClientCommissionsSheet(
  data: ClientCommissionsData
): ClientCommissionsSheet | ClientCommissionsFailure {
  const { session, client: clientRow, comparisons } = data;
  const fail = (status: 400 | 404, message: string): ClientCommissionsFailure => ({ ok: false, status, message });
  if (!session) return fail(404, SESSION_NOT_FOUND_MESSAGE);
  if (!clientRow) return fail(404, CLIENT_NOT_FOUND_MESSAGE);
  if (comparisons.length === 0) return fail(400, NO_APPROVED_ROWS_MESSAGE);

  const { start, end } = monthBounds(session.periodYear, session.periodMonth);
  const ctx: RowContext = {
    clientId: session.clientId,
    client: clientRow,
    docKind: data.docKind,
    periodStart: start,
    periodEnd: end,
    halve: isLaTableInvoice(clientRow, data.docKind),
  };
  const rows = comparisons.filter((comp) => netOf(comp) !== 0).map((comp) => toBuiltRow(comp, ctx));
  if (rows.length === 0) return fail(400, ALL_ZERO_MESSAGE);
  return { ok: true, session, rows };
}

/** The Excel route answers with a status; the API path reports the same text as a blocking error. */
export function buildClientCommissionsRows(
  data: ClientCommissionsData
): { rows: BuiltRow[]; blockingErrors: string[] } {
  const sheet = buildClientCommissionsSheet(data);
  if (!sheet.ok) return { rows: [], blockingErrors: [sheet.message] };
  const sendable = apiDocumentId(DOCUMENT_TYPES[data.docKind]) !== null;
  return { rows: sheet.rows, blockingErrors: sendable ? [] : [copy.unsupportedJournalDocType] };
}

export const clientCommissionsExport: ExportDefinition = {
  type: "client_commissions",
  plugin: "imovein",
  labelHe: exportLabels.client_commissions,
  build: async (params) =>
    buildClientCommissionsRows(await loadClientCommissionsData(clientCommissionsParams.parse(params))),
};
