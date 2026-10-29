import { database } from "@/db";
import { franchisee } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  getApprovedForExport,
  tenbisUsesJournalEntries,
  type ExportRow,
} from "@/data-access/client-reconciliation-approval";
import { franchiseePeriodParams } from "@/schemas/hashavshevet";
import { exportLabels } from "../copy";
import {
  apiDate,
  apiMoney,
  internalReference,
  JOURNAL_TRANS_TYPE,
  lastDayOfMonth,
  REFERENCE_PREFIX,
  roundCents,
} from "../format";
import type { ExportDefinition } from "../registry";
import type { ApiRow, BuiltRow } from "../types";

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

/** What the export needs of the franchisee: the revenue-account override and its own Hashavshevet company. */
export interface JournalEntriesFranchisee {
  name: string;
  hashavshevetRevenueAccount: string | null;
  /** The franchisee's own Hashavshevet company; null = unmapped. */
  hashavshevetCompanyId: string | null;
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
      hashavshevetCompanyId: franchisee.hashavshevetCompanyId,
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

// ============================================================================
// ROWS (pure)
// ============================================================================

/** The eleven Excel columns A–K, in order. `display` keys match these. */
export const JOURNAL_ENTRIES_HEADERS = [
  "אסמתכא 2", // Reut's sample typo preserved
  "תאריך אסמכתא",
  "תאריך ערך",
  "חן חובה",
  "חן זכות 1",
  "חן זכות 2",
  "סכום חובה",
  "סכום זכות 1",
  "סכום זכות 2",
  "פרטים",
  "מספר הקצאה",
] as const;

type Column = (typeof JOURNAL_ENTRIES_HEADERS)[number];

// Israeli מע"מ (VAT) rate — 18% since January 2025.
export const VAT_RATE = 0.18;
const REVENUE_ACCOUNT = "הכנסות";
const VAT_ACCOUNT = "מעמעס";

// פרטים (row-description) labels shown in column J.
const DETAILS_MEALS = "ארוחות";
const DETAILS_HEVER_COMMISSION = "עמלה";
const DETAILS_HEVER_CONTRA = "מיון";

// HEVER — special two-row journal-entry format.
// Row 1: VAT-split row for HEVER, amount = −18% of original (commission).
// Row 2: contra entry for the gross: debits HEVER (D, חן חובה) and credits "אמריקן" (E, חן זכות 1), no VAT split.
const HEVER_CLIENT_CODE = "HEVER";
const HEVER_COMMISSION_RATE = 0.18;
const HEVER_CONTRA_ACCOUNT = "אמריקן";
// HEVER-specific credit account for the commission row — routed to a
// dedicated commission account instead of the generic revenue one.
const HEVER_COMMISSION_CREDIT_ACCOUNT = "הכנ עמלות חבר";
// HEVER's bank-transfer file has no per-franchisee invoice number — Reut
// asked to fill a fixed placeholder in אסמכתא 2 for both HEVER rows.
const HEVER_ASMACHTA_PLACEHOLDER = "9999";

// Clients whose uploads actually carry an invoice number we can extract.
// Anything outside this set (CIBUS, …) leaves אסמכתא 2 empty per Reut.
// TENBIS added 2026-07 — self-billed from the July-2026 period.
const INVOICE_BEARING_CLIENT_CODES = new Set(["MISHLOCHA", "HAAT", "WOLT", "TENBIS"]);

export const FRANCHISEE_NOT_FOUND_MESSAGE = "זכיין לא נמצא";
export const NO_JOURNAL_CLIENTS_MESSAGE = "אין לקוחות עם הפקת פקודת יומן מסומנת בתקופה זו";
export const ALL_ZERO_MESSAGE = "אין סכומים לייצוא (כל הסכומים אפס)";

export type LineKind = "regular" | "hever_commission" | "hever_contra";

/** One journal line, column by column. Only the HEVER contra line has no VAT split. */
interface Line {
  clientId: string;
  kind: LineKind;
  asmachta2: string;
  debitAccount: string;
  credit1: string;
  /** Exact amount, never rounded (Reut reconciles VAT to the agora). */
  amount: number;
  details: string;
  allocationNumber: string;
}

/** The workbook needs one fact `display` can't carry: whether H and I are VAT formulas. */
export interface JournalSheetLine {
  row: BuiltRow;
  vatSplit: boolean;
}

/** Why nothing can be exported: the Excel route answers with `status`, the API path blocks with `message`. */
export type JournalEntriesSheet =
  | { ok: true; lines: JournalSheetLine[] }
  | { ok: false; status: 400 | 404; message: string };

/**
 * אסמכתא 2 per-client rule (Reut): real invoice# (last 4 digits) only for
 * MISHLOCHA/HAAT/WOLT/TENBIS; HEVER gets the "9999" placeholder on both of its
 * rows; CIBUS and anything else stay empty.
 */
function asmachta2Of(row: ExportRow): string {
  return row.clientCode === HEVER_CLIENT_CODE
    ? HEVER_ASMACHTA_PLACEHOLDER
    : row.clientCode && INVOICE_BEARING_CLIENT_CODES.has(row.clientCode) && row.invoiceNumber
      ? row.invoiceNumber.replace(/\D/g, "").slice(-4)
      : "";
}

/**
 * Journal-entries export uses a name-first fallback (unique to this sheet — the
 * other exports use code-first). Still honours the per-brand override when present.
 */
function debitAccountOf(row: ExportRow): string {
  const perBrandOverride =
    row.franchiseeBrandId && row.hashavshevetByBrand ? row.hashavshevetByBrand[row.franchiseeBrandId]?.trim() : "";
  return perBrandOverride || row.hashavshevetName || row.hashavshevetCode || row.clientName;
}

/**
 * Wolt prefers its net amount (what we actually pay on Wolt's invoice); everyone
 * else uses the client-reported amount. No rounding — Reut needs exact values
 * including אגורות for the accountant's VAT reconcile.
 */
function amountOf(row: ExportRow): number {
  return row.clientCode === "WOLT" && row.netAmount !== null ? row.netAmount : row.clientAmount;
}

/** One line per client; HEVER emits a commission line and a contra line that REPLACE it. */
function linesOf(row: ExportRow, amount: number, revenueAccount: string): Line[] {
  const base = { clientId: row.clientId, asmachta2: asmachta2Of(row), debitAccount: debitAccountOf(row) };
  // Israeli tax allocation number (מספר הקצאה) — empty when the invoice
  // didn't carry one (under threshold, or pre-feature documents).
  const allocationNumber = row.allocationNumber ?? "";
  if (row.clientCode === HEVER_CLIENT_CODE) {
    return [
      {
        ...base,
        kind: "hever_commission",
        credit1: HEVER_COMMISSION_CREDIT_ACCOUNT,
        amount: -(amount * HEVER_COMMISSION_RATE), // −18% of gross
        details: DETAILS_HEVER_COMMISSION,
        allocationNumber,
      },
      // Contra row — not an invoice line, so no allocation number.
      { ...base, kind: "hever_contra", credit1: HEVER_CONTRA_ACCOUNT, amount, details: DETAILS_HEVER_CONTRA, allocationNumber: "" },
    ];
  }
  // Credit 1 honours the per-franchisee revenue account (e.g. Natanzon).
  return [{ ...base, kind: "regular", credit1: revenueAccount, amount, details: DETAILS_MEALS, allocationNumber }];
}

const isVatSplit = (line: Line): boolean => line.kind !== "hever_contra";

/** The Excel's [H, I] on a VAT-split row: exactly the values cached under its `=G-I` and `=G/1.18*0.18` formulas. */
function excelSplit(gross: number): [number, number] {
  const vat = (gross * VAT_RATE) / (1 + VAT_RATE);
  return [gross - vat, vat];
}

/** The eleven columns as the Excel shows them; the HEVER contra row has a static gross H and no F/I. */
function displayOf(line: Line, date: string): Record<Column, string | number> {
  const [preVat, vat]: [number, number | ""] = isVatSplit(line) ? excelSplit(line.amount) : [line.amount, ""];
  return {
    "אסמתכא 2": line.asmachta2,
    "תאריך אסמכתא": date,
    "תאריך ערך": date,
    "חן חובה": line.debitAccount,
    "חן זכות 1": line.credit1,
    "חן זכות 2": isVatSplit(line) ? VAT_ACCOUNT : "",
    "סכום חובה": line.amount,
    "סכום זכות 1": preVat,
    "סכום זכות 2": vat,
    "פרטים": line.details,
    "מספר הקצאה": line.allocationNumber,
  };
}

/**
 * Hashavshevet rejects an unbalanced entry, so the API never sends the Excel's
 * unrounded split: i is the VAT of the rounded debit, h the rest, and h + i === g
 * to the agora. Negative amounts keep their sign on both sides.
 */
function balancedSplit(g: number): [number, number] {
  const i = roundCents((g / (1 + VAT_RATE)) * VAT_RATE);
  return [roundCents(g - i), i];
}

/** The movein row: computed values (never formulas), all strings, empty fields left out. */
function apiRowOf(line: Line, rowKey: string, periodEnd: string): ApiRow {
  const date = apiDate(periodEnd);
  const g = roundCents(line.amount);
  const [h, i] = isVatSplit(line) ? balancedSplit(g) : [g, null];
  const fields: ApiRow = {
    TransType: JOURNAL_TRANS_TYPE,
    Reference: internalReference(REFERENCE_PREFIX, rowKey),
    Ref2: line.asmachta2,
    ValueDate: date,
    DueDate: date,
    AccountKeyDeb1: line.debitAccount,
    SuFDeb1: apiMoney(g),
    AccountKeyCred1: line.credit1,
    SuFCred1: apiMoney(h),
    AccountKeyCred2: i === null ? "" : VAT_ACCOUNT,
    SuFCred2: i === null ? "" : apiMoney(i),
    Details: line.details,
    // The allocation number goes as the exact string: some start with 0.
    TaxAPINumber: line.allocationNumber,
  };
  return Object.fromEntries(Object.entries(fields).filter(([, value]) => value !== ""));
}

function toSheetLine(line: Line, data: JournalEntriesData): JournalSheetLine {
  const { franchiseeId, periodMonth, periodYear } = data;
  // getApprovedForExport emits one row per client id (all of the client's documents for the
  // franchisee x month summed into it), so the line kind is the only extra part HEVER needs.
  const rowKey = `${line.clientId}|${franchiseeId}|${periodYear}-${String(periodMonth).padStart(2, "0")}|${line.kind}`;
  const periodEnd = lastDayOfMonth(periodYear, periodMonth);
  const row: BuiltRow = {
    rowKey,
    companyId: data.franchisee?.hashavshevetCompanyId ?? null,
    documentKey: rowKey, // each journal line is its own entry
    amount: roundCents(line.amount),
    display: displayOf(line, apiDate(periodEnd)),
    apiRow: apiRowOf(line, rowKey, periodEnd),
    periodEnd,
  };
  return { row, vatSplit: isVatSplit(line) };
}

/** The Excel file's lines, or the reason there are none. */
export function buildJournalEntriesSheet(data: JournalEntriesData): JournalEntriesSheet {
  const { franchisee: fr, periodMonth, periodYear } = data;
  if (!fr) return { ok: false, status: 404, message: FRANCHISEE_NOT_FOUND_MESSAGE };

  const journalRows = data.approved.filter(
    (a) =>
      a.journalEntryGeneration === true &&
      // TENBIS cutover: pre-July-2026 periods stay in the client-invoices export.
      !(a.clientCode === "TENBIS" && !tenbisUsesJournalEntries(periodMonth, periodYear))
  );
  if (journalRows.length === 0) return { ok: false, status: 400, message: NO_JOURNAL_CLIENTS_MESSAGE };

  // Per-franchisee column wins; falls back to the global default.
  const revenueAccount = fr.hashavshevetRevenueAccount?.trim() || REVENUE_ACCOUNT;
  const lines = journalRows
    .map((row) => ({ row, amount: amountOf(row) }))
    .filter((x) => x.amount !== 0)
    .flatMap(({ row, amount }) => linesOf(row, amount, revenueAccount));
  if (lines.length === 0) return { ok: false, status: 400, message: ALL_ZERO_MESSAGE };
  return { ok: true, lines: lines.map((line) => toSheetLine(line, data)) };
}

/** The Excel route answers with a status; the API path reports the same text as a blocking error. */
export function buildJournalEntriesRows(data: JournalEntriesData): { rows: BuiltRow[]; blockingErrors: string[] } {
  const sheet = buildJournalEntriesSheet(data);
  if (!sheet.ok) return { rows: [], blockingErrors: [sheet.message] };
  return { rows: sheet.lines.map((line) => line.row), blockingErrors: [] };
}

export const journalEntriesExport: ExportDefinition = {
  type: "journal_entries",
  plugin: "movein",
  labelHe: exportLabels.journal_entries,
  build: async (params) => buildJournalEntriesRows(await loadJournalEntriesData(franchiseePeriodParams.parse(params))),
};
