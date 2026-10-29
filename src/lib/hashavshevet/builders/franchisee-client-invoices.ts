import { database } from "@/db";
import { franchisee } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getApprovedForExport,
  tenbisUsesJournalEntries,
  type ExportRow,
} from "@/data-access/client-reconciliation-approval";
import {
  getOccasionalClientsForExport,
  type OccasionalClientExportRow,
} from "@/data-access/occasional-clients";
import { franchiseePeriodParams } from "@/schemas/hashavshevet";
import { exportLabels } from "../copy";
import { apiDiscountPct, apiDocumentId, apiMoney, apiQuantity, lastDayOfMonth } from "../format";
import type { ExportDefinition } from "../registry";
import type { ApiRow, BuiltRow } from "../types";

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

/** What the export needs of the franchisee: the item-key override and its own Hashavshevet company. */
export interface FranchiseeClientInvoicesFranchisee {
  name: string;
  hashavshevetRevenueAccount: string | null;
  /** The franchisee's own Hashavshevet company; null = unmapped. */
  hashavshevetCompanyId: string | null;
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
      hashavshevetCompanyId: franchisee.hashavshevetCompanyId,
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

// ============================================================================
// ROWS (pure)
// ============================================================================

/** The nine Excel columns, in order. `display` keys match these. */
export const FRANCHISEE_CLIENT_INVOICES_HEADERS = [
  "מפתח חשבון",
  "שם",
  "מפתח פריט",
  "שם פריט",
  "כמות",
  "מחיר",
  "אחוז הנחה לפריט",
  "סוג המסמך",
  "מספר מסמך",
] as const;

const ITEM_KEY = "ארוחות";
// Gift cards are a distinct Hashavshevet item, not a meal — Reut 2026-06-15.
const ITEM_KEY_GIFTCARD = "גיפט";
// "אחוז הנחה לפריט" — stored as a 4-decimal number (not a fraction).
// 15.2543 is Reut's precise value for the VAT share (18 / 118 ≈ 15.2542%);
// GIFTCARD uses its own value per the accounting setup.
const DISCOUNT_PCT_DEFAULT = 15.2543;
const DISCOUNT_PCT_GIFTCARD = 19.2543;
/** Excel "סוג המסמך": 11 = invoice (חשבונית). */
const DOCUMENT_TYPE = 11;

export const FRANCHISEE_NOT_FOUND_MESSAGE = "זכיין לא נמצא";
export const NO_INVOICE_CLIENTS_MESSAGE = "אין לקוחות עם הפקת חשבונית מסומנת בתקופה זו";
export const ALL_ZERO_MESSAGE = "אין סכומים לייצוא (כל הסכומים אפס)";

/** Why nothing can be exported: the Excel route answers with `status`, the API path blocks with `message`. */
export interface FranchiseeClientInvoicesFailure {
  ok: false;
  status: 400 | 404;
  message: string;
}

export interface FranchiseeClientInvoicesSheet {
  ok: true;
  rows: BuiltRow[];
}

/**
 * One invoice line before numbering. `clientId` is the occasional client's id for occasional rows;
 * `clientKind` keeps the two id spaces apart in the rowKey.
 */
interface Entry {
  clientKind: "client" | "occasional";
  clientId: string;
  accountKey: string;
  itemKey: string;
  discountPct: number;
  price: number;
}

/** The invoice amount per client: WOLT exact net, La Table half, everyone else whole shekels. */
function priceOf(a: ExportRow): number {
  // Defensive: WOLT shouldn't normally be invoiceGeneration=true, but if
  // it is, keep the exact-decimal rule. All other clients get rounded
  // (matches Reut's sample where סיבוס/תן ביס are whole-shekel).
  if (a.clientCode === "WOLT") return a.netAmount !== null ? a.netAmount : a.clientAmount;
  // La Table (incl. the LATABLEMARK marketing variant): the UI shows
  // the original Tabit amount but the invoice we issue to the client
  // is for half of it (accounting arrangement).
  if (a.clientCode === "LATABLE" || a.clientCode === "LATABLEMARK") return Math.round(a.clientAmount / 2);
  return Math.round(a.clientAmount);
}

function regularEntries(data: FranchiseeClientInvoicesData, itemKeyOverride: string): Entry[] {
  const { approved, periodMonth, periodYear } = data;
  return approved
    .filter(
      (a) =>
        a.invoiceGeneration === true ||
        // TENBIS cutover: its flag flipped to journal entries, but pre-July-2026
        // periods must still export as client invoices.
        (a.clientCode === "TENBIS" && !tenbisUsesJournalEntries(periodMonth, periodYear))
    )
    .map((a) => {
      const isGiftcard = a.clientCode === "GIFTCARD";
      return {
        clientKind: "client" as const,
        clientId: a.clientId,
        accountKey: a.accountKey,
        // Item key (מפתח פריט) priority: GIFTCARD always uses its own item
        // ("גיפט") — it's a distinct product, not a meal. Otherwise the
        // client-level override (per-brand or global, e.g. LATABLEMARK →
        // "ארוחותש") wins, then the franchisee-level override (Natanzon →
        // "הכנסותנ"), then the default ITEM_KEY ("ארוחות").
        itemKey: isGiftcard ? ITEM_KEY_GIFTCARD : a.clientItemKey || itemKeyOverride || ITEM_KEY,
        // GIFTCARD uses a 19.25% discount column instead of the default 15.25%.
        discountPct: isGiftcard ? DISCOUNT_PCT_GIFTCARD : DISCOUNT_PCT_DEFAULT,
        price: priceOf(a),
      };
    });
}

/**
 * Occasional-client rows — same whole-shekel rounding rule as non-WOLT.
 * `getOccasionalClientsForExport` already filters out rows lacking a
 * Hashavshevet name, so `o.hashavshevetName` is guaranteed non-empty.
 */
function occasionalEntries(data: FranchiseeClientInvoicesData, itemKeyOverride: string): Entry[] {
  return data.occasional.map((o) => ({
    clientKind: "occasional" as const,
    clientId: o.occasionalClientId,
    accountKey: o.hashavshevetName,
    itemKey: itemKeyOverride || ITEM_KEY,
    discountPct: DISCOUNT_PCT_DEFAULT,
    price: Math.round(o.totalAmount),
  }));
}

/**
 * The H-Connect row. Independent of the Excel: if the document type ever lost its
 * API mapping (it is covered by a unit test) the row degrades to empty instead of
 * throwing, so the Excel always builds.
 */
function apiRowOf(entry: Entry, documentNumber: number): ApiRow {
  const documentId = apiDocumentId(DOCUMENT_TYPE);
  if (documentId === null) return {};
  return {
    accountKey: entry.accountKey,
    itemkey: entry.itemKey,
    Quantity: apiQuantity(1),
    price: apiMoney(entry.price),
    Discountprc: apiDiscountPct(entry.discountPct),
    DocumentID: documentId,
    Reference: String(documentNumber),
  };
}

function toBuiltRow(entry: Entry, documentNumber: number, data: FranchiseeClientInvoicesData): BuiltRow {
  const { franchiseeId, periodMonth, periodYear } = data;
  // One row per client x franchisee x month (approved rows are one per client id; occasional documents
  // are unique per occasional client, franchisee and period), so the item key stays out of the key:
  // changing an item override must not make an already sent invoice look new (ruling R22).
  const rowKey = `${entry.clientKind}:${entry.clientId}|${franchiseeId}|${periodYear}-${String(periodMonth).padStart(2, "0")}`;
  const display: Record<(typeof FRANCHISEE_CLIENT_INVOICES_HEADERS)[number], string | number> = {
    "מפתח חשבון": entry.accountKey,
    "שם": "",
    "מפתח פריט": entry.itemKey,
    "שם פריט": "",
    "כמות": 1,
    "מחיר": entry.price,
    // 4-decimal number (default 15.2543, GIFTCARD 19.2543)
    "אחוז הנחה לפריט": entry.discountPct,
    "סוג המסמך": DOCUMENT_TYPE,
    "מספר מסמך": documentNumber,
  };
  return {
    rowKey,
    companyId: data.franchisee?.hashavshevetCompanyId ?? null,
    documentKey: rowKey,
    amount: entry.price,
    display,
    apiRow: apiRowOf(entry, documentNumber),
    periodEnd: lastDayOfMonth(periodYear, periodMonth),
  };
}

/** The Excel file's rows, or the reason there are none. Independent of the API mapping. */
export function buildFranchiseeClientInvoicesSheet(
  data: FranchiseeClientInvoicesData
): FranchiseeClientInvoicesSheet | FranchiseeClientInvoicesFailure {
  const fail = (status: 400 | 404, message: string): FranchiseeClientInvoicesFailure => ({ ok: false, status, message });
  const fr = data.franchisee;
  if (!fr) return fail(404, FRANCHISEE_NOT_FOUND_MESSAGE);

  // Per-franchisee override for column C (מפתח פריט). Reuses the same column
  // that drives the journal-entries export's revenue account (e.g. Natanzon
  // → "הכנסותנ"). LATABLEMARK still wins on its own row — see below.
  const itemKeyOverride = fr.hashavshevetRevenueAccount?.trim() || "";

  const regular = regularEntries(data, itemKeyOverride);
  // The "no clients" guard looks at the clients before the zero skip.
  if (regular.length === 0 && data.occasional.length === 0) return fail(400, NO_INVOICE_CLIENTS_MESSAGE);

  const entries = [...regular, ...occasionalEntries(data, itemKeyOverride)].filter((e) => e.price !== 0);
  if (entries.length === 0) return fail(400, ALL_ZERO_MESSAGE);
  return { ok: true, rows: entries.map((entry, index) => toBuiltRow(entry, index + 1, data)) };
}

/** The Excel route answers with a status; the API path reports the same text as a blocking error. */
export function buildFranchiseeClientInvoicesRows(
  data: FranchiseeClientInvoicesData
): { rows: BuiltRow[]; blockingErrors: string[] } {
  const sheet = buildFranchiseeClientInvoicesSheet(data);
  if (!sheet.ok) return { rows: [], blockingErrors: [sheet.message] };
  return { rows: sheet.rows, blockingErrors: [] };
}

export const franchiseeClientInvoicesExport: ExportDefinition = {
  type: "franchisee_client_invoices",
  plugin: "imovein",
  labelHe: exportLabels.franchisee_client_invoices,
  build: async (params) =>
    buildFranchiseeClientInvoicesRows(await loadFranchiseeClientInvoicesData(franchiseePeriodParams.parse(params))),
};
