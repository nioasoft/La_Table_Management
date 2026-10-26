import {
  getCommissionInvoicesForExport,
  type CommissionInvoiceExportRow,
} from "@/data-access/commission-invoices";
import { getVatRateForDate } from "@/data-access/vatRates";
import { resolveClientHashavshevetAccount } from "@/lib/hashavshevet-account";
import { clientCommissionInvoicesParams } from "@/schemas/hashavshevet";
import { copy, exportLabels } from "../copy";
import {
  apiDate,
  apiMoney,
  EXPENSE_JOURNAL_TRANS_TYPE,
  internalReference,
  lastDayOfMonth,
  REFERENCE_PREFIX,
  roundCents,
} from "../format";
import type { ExportDefinition } from "../registry";
import type { ApiRow, BuiltRow } from "../types";

/**
 * Client commission-invoices export ("חשבוניות עמלה מלקוחות"): the row logic shared by the
 * Excel route (clients/commission-invoices/export) and the Hashavshevet API send path.
 * Queries and rules moved out of the route verbatim; the Excel output must not change by a single number.
 */

export interface ClientCommissionInvoicesParams {
  periodMonth: number;
  periodYear: number;
  /** Restrict to one franchisee; null/absent = every franchisee. */
  franchiseeId?: string | null;
}

export interface ClientCommissionInvoicesData {
  periodMonth: number;
  periodYear: number;
  /** One row per commission_invoice document of the period (zero/negative totals already dropped). */
  rows: CommissionInvoiceExportRow[];
  /** VAT rate effective on the period's last day: all rows of the export share it. */
  vatRate: number;
}

/** All DB reads of the export. Read-only. */
export async function loadClientCommissionInvoicesData(
  params: ClientCommissionInvoicesParams
): Promise<ClientCommissionInvoicesData> {
  const { periodMonth, periodYear, franchiseeId = null } = params;
  const rows = await getCommissionInvoicesForExport(periodMonth, periodYear, franchiseeId);
  // new Date(y, m, 0) = last day of month m (1-based), from local parts.
  const vatRate = await getVatRateForDate(new Date(periodYear, periodMonth, 0));
  return { periodMonth, periodYear, rows, vatRate };
}

// ============================================================================
// ROWS (pure)
// ============================================================================

/**
 * The eleven Excel columns A–K, in order. `display` keys match these. Verbatim from the
 * user's template file (typos preserved on purpose): Hashavshevet's importer expects this exact layout.
 */
export const CLIENT_COMMISSION_INVOICES_HEADERS = [
  "אסמתכא 2", // A — last 4 digits of invoice number
  "תאריך אסמכתא", // B — last day of the period, as an Excel serial
  "תאריך ערך", // C — value date (same as B)
  "חן חובה 1", // D — fixed: "עמלות מלקוחות"
  "חוז חובה 2", // E — fixed: "מעמתש"
  "חן זכות", // F — client's Hashavshevet account (per brand)
  "סכום חובה", // G — pre-VAT amount = I / (1 + vat)
  "סכום חובה 2", // H — VAT amount = I − G
  "סכום זכות 2", // I — total with VAT
  "פרטים", // J — "עמלה <Hebrew month>"
  "מספר הקצאה", // K — Israeli tax allocation number (9 digits) when invoice ≥ ₪10K
] as const;

const DEBIT_ACCOUNT_1 = "עמלות מלקוחות";
const DEBIT_ACCOUNT_2 = "מעמתש";

const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
];

/** What every row of the export shares: all of them fall in the same month. */
interface PeriodFacts {
  /** YYYY-MM-DD of the last day. */
  end: string;
  /** Excel serial of that day. */
  serial: number;
  description: string;
  vatMultiplier: number;
}

// Excel epoch is 1899-12-30 (accounts for the Lotus 1-2-3 leap-year bug).
// Using UTC on both sides avoids any DST/timezone drift for a whole-day serial.
// Date.UTC(y, m, 0) with a 1-based month m is the last day of that month.
function lastDaySerial(year: number, month: number): number {
  return Math.floor((Date.UTC(year, month, 0) - Date.UTC(1899, 11, 30)) / 86_400_000);
}

function periodFactsOf(data: ClientCommissionInvoicesData): PeriodFacts {
  const { periodMonth, periodYear, vatRate } = data;
  return {
    end: lastDayOfMonth(periodYear, periodMonth),
    serial: lastDaySerial(periodYear, periodMonth),
    description: `עמלה ${HEBREW_MONTHS[periodMonth - 1]}`,
    vatMultiplier: 1 + vatRate,
  };
}

function invoiceRef(invoiceNumber: string | null): string {
  if (!invoiceNumber) return "";
  const digits = invoiceNumber.replace(/\D/g, "");
  const base = digits.length > 0 ? digits : invoiceNumber;
  return base.slice(-4);
}

/** One document, column by column. */
interface Line {
  rowKey: string;
  ref: string;
  account: string;
  net: number;
  vat: number;
  total: number;
  allocationNumber: string;
}

/** The movein row: computed values, all strings, empty fields left out. */
function apiRowOf(line: Line, period: PeriodFacts): ApiRow {
  const date = apiDate(period.end);
  const fields: ApiRow = {
    TransType: EXPENSE_JOURNAL_TRANS_TYPE,
    Reference: internalReference(REFERENCE_PREFIX, line.rowKey),
    Ref2: line.ref,
    ValueDate: date,
    DueDate: date,
    AccountKeyDeb1: DEBIT_ACCOUNT_1,
    AccountKeyDeb2: DEBIT_ACCOUNT_2,
    AccountKeyCred1: line.account,
    SuFDeb1: apiMoney(line.net),
    SuFDeb2: apiMoney(line.vat),
    SuFCred1: apiMoney(line.total),
    Details: period.description,
    // The allocation number goes as the exact string: some start with 0.
    TaxAPINumber: line.allocationNumber,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== ""));
}

/**
 * Ruling R28: keyed by the invoice number, not the client_document id. Reut deletes and
 * re-uploads documents; a new id for the same invoice would read as a new row and allow a second
 * send. A number repeated for the same client × franchisee errs the safe way: it shows as
 * sent/changed, never as a silent duplicate. Without a number the document id is all there is.
 */
function rowKeyOf(invoice: CommissionInvoiceExportRow): string {
  const owner = `${invoice.clientId}|${invoice.franchiseeId}`;
  const number = invoice.invoiceNumber?.trim();
  return number ? `${owner}|inv:${number}` : `${owner}|doc:${invoice.invoiceDocumentId}`;
}

function toBuiltRow(invoice: CommissionInvoiceExportRow, period: PeriodFacts): BuiltRow {
  const total = roundCents(invoice.totalAmountWithVat);
  const net = roundCents(total / period.vatMultiplier);
  // H = I − G after rounding, so G + H === I to the agora: the entry always balances.
  const vat = roundCents(total - net);
  const line: Line = {
    rowKey: rowKeyOf(invoice),
    ref: invoiceRef(invoice.invoiceNumber),
    account: resolveClientHashavshevetAccount(invoice.clientHashavshevet, invoice.brandId),
    net,
    vat,
    total,
    // Empty when the invoice is below the threshold.
    allocationNumber: invoice.allocationNumber ?? "",
  };
  return {
    rowKey: line.rowKey,
    companyId: invoice.franchiseeHashavshevetCompanyId,
    documentKey: line.rowKey,
    amount: total,
    display: {
      "אסמתכא 2": line.ref,
      "תאריך אסמכתא": period.serial,
      "תאריך ערך": period.serial,
      "חן חובה 1": DEBIT_ACCOUNT_1,
      "חוז חובה 2": DEBIT_ACCOUNT_2,
      "חן זכות": line.account,
      "סכום חובה": net,
      "סכום חובה 2": vat,
      "סכום זכות 2": total,
      "פרטים": period.description,
      "מספר הקצאה": line.allocationNumber,
    },
    apiRow: apiRowOf(line, period),
    periodEnd: period.end,
  };
}

/**
 * Every document is a row, in the loader's order. The Excel keeps a row whose total rounds to
 * 0.00 (it only drops totals <= 0 before rounding), so it stays here too; the API path blocks
 * the send instead, naming the invoice, so an empty journal line never reaches Hashavshevet.
 * An empty period has no rows: the Excel route answers 400 with the same text.
 */
export function buildClientCommissionInvoicesRows(
  data: ClientCommissionInvoicesData
): { rows: BuiltRow[]; blockingErrors: string[] } {
  if (data.rows.length === 0) return { rows: [], blockingErrors: [copy.noCommissionInvoices] };
  const period = periodFactsOf(data);
  const rows = data.rows.map((invoice) => toBuiltRow(invoice, period));
  const blockingErrors = data.rows
    .filter((_, i) => rows[i].amount === 0)
    .map((invoice) => copy.zeroCommissionInvoice(invoice.invoiceNumber, invoice.clientName, invoice.franchiseeName));
  return { rows, blockingErrors };
}

export const clientCommissionInvoicesExport: ExportDefinition = {
  type: "client_commission_invoices",
  plugin: "movein",
  labelHe: exportLabels.client_commission_invoices,
  build: async (params) =>
    buildClientCommissionInvoicesRows(await loadClientCommissionInvoicesData(clientCommissionInvoicesParams.parse(params))),
};
