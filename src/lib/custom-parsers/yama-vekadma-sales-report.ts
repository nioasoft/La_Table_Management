/**
 * ימה וקדמה — "ניתוח מכירות תקופתי" sales report (second file format, 2026-07).
 *
 * The supplier's ERP exports this as a `.xls` that is really a UTF-16LE HTML
 * document: one `<TABLE>` with a title row, a header row, and one row per
 * (month × customer × item):
 *
 *   חודש | (ריק) | לקוח | שם לקוח | ברקוד | שם פריט | כמות | מחיר ממוצע | סכום
 *
 * Amount semantics:
 *   - `סכום` = כמות × מחיר ממוצע, **excluding VAT** (the ERP's sale price;
 *     e.g. פריט פקדון at 0.26 while the statutory deposit is ₪0.30 incl. VAT).
 *     So netAmount = the reported amount and grossAmount = net × 1.18 —
 *     the opposite of the כרטסת ledger format, where amounts include VAT.
 *   - Credit rows arrive as negative quantities/amounts and simply net out.
 *
 * Output: one row per customer, aggregated across every month in the file,
 * `date` = latest month present for that customer.
 *
 * The file's own date range is chosen by whoever ran the report and does not
 * have to match the settlement period (the 2026-07-30 export covered
 * 01/04–01/07, i.e. Q2 plus a July tail). Since `syncCommissionsFromUpload`
 * sums every parsed row regardless of date, the month breakdown is surfaced as
 * a MIXED_PERIODS anomaly for the admin to eyeball before saving.
 */

import {
  type FileProcessingResult,
  type ParsedRowData,
  roundAmount,
} from "../file-processor";
import {
  type FileProcessingError,
  createFileProcessingError,
} from "../file-processing-errors";
import type { Anomaly } from "@/types/file-anomalies";

const VAT_RATE = 0.18;

const HEADER_MONTH = "חודש";
const HEADER_CUSTOMER = "שם לקוח";
const HEADER_AMOUNT = "סכום";

// Month cell: DD/MM/YYYY (the ERP always emits the 1st of the month)
const MONTH_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/;

interface CustomerAccumulator {
  name: string;
  total: number;
  latestDate: Date | null;
  firstRow: number;
}

/**
 * Decode the report buffer to text. The ERP writes UTF-16LE with a BOM while
 * declaring `charset=UTF-8` in the meta tag, which is why SheetJS reads it as
 * mojibake — decode by BOM, not by declaration.
 */
export function decodeSalesReport(buffer: Buffer): string {
  const text =
    buffer[0] === 0xff && buffer[1] === 0xfe
      ? buffer.toString("utf16le")
      : buffer.toString("utf8");
  return text.charCodeAt(0) === 0xfeff ? text.slice(1) : text;
}

/** True when the decoded text is the HTML sales report (not the .xls ledger). */
export function isSalesReport(text: string): boolean {
  return (
    /<table\b/i.test(text) &&
    text.includes(HEADER_CUSTOMER) &&
    text.includes(HEADER_AMOUNT)
  );
}

const ENTITIES: Record<string, string> = {
  "&amp;": "&",
  "&lt;": "<",
  "&gt;": ">",
  "&quot;": '"',
  "&#39;": "'",
  "&nbsp;": " ",
};

function cellText(html: string): string {
  return html
    .replace(/<[^>]*>/g, "")
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, (e) => ENTITIES[e] ?? e)
    .trim();
}

function extractRows(text: string): string[][] {
  return [...text.matchAll(/<tr\b[^>]*>([\s\S]*?)<\/tr>/gi)].map((tr) =>
    [...tr[1].matchAll(/<t[dh]\b[^>]*>([\s\S]*?)<\/t[dh]>/gi)].map((td) =>
      cellText(td[1])
    )
  );
}

function toNumber(value: string): number {
  const s = value.replace(/[₪,\s]/g, "");
  if (s === "" || s === "-") return 0;
  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Parse the month cell in local time (toISOString would shift the day — see
 * CLAUDE.md).
 *
 * Two shapes reach here. The HTML report writes DD/MM/YYYY as text. A workbook
 * writes a date-formatted number, and the browser's WAF-driven .xls→.xlsx
 * re-encode drops the number format — so the cell arrives as a bare Excel
 * serial with nothing left to say it was ever a date.
 */
function parseMonth(value: string): Date | null {
  const serial = value.match(/^\d{5}$/) ? parseInt(value, 10) : NaN;
  if (!Number.isNaN(serial)) {
    // Excel's day 0 is 1899-12-30 (its 1900 leap-year bug included).
    const utc = new Date(Date.UTC(1899, 11, 30) + serial * 86400000);
    return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
  }
  const m = value.match(MONTH_RE);
  if (!m) return null;
  const day = parseInt(m[1], 10);
  const month = parseInt(m[2], 10);
  const year = parseInt(m[3], 10);
  if (month < 1 || month > 12 || day < 1 || day > 31) return null;
  const d = new Date(year, month - 1, day);
  return Number.isNaN(d.getTime()) ? null : d;
}

/** Sortable YYYY-MM key; rendered as MM/YYYY for the admin. */
function monthKey(d: Date): string {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}`;
}

function monthLabel(key: string): string {
  const [year, month] = key.split("-");
  return `${month}/${year}`;
}

export function parseYamaVekadmaSalesReport(text: string): FileProcessingResult {
  return parseSalesReportGrid(extractRows(text));
}

/**
 * True when a worksheet grid is the sales report rather than the כרטסת ledger.
 *
 * The same report also arrives as a genuine workbook: anyone who opens the
 * ERP's HTML-table `.xls` in Excel and saves it produces one, which is exactly
 * what happens when a file is repaired by hand. `isSalesReport` only knows the
 * HTML wrapper, so the grid has to be recognised by its own header row.
 */
export function isSalesReportGrid(rows: string[][]): boolean {
  return rows.some(
    (r) => r.includes(HEADER_CUSTOMER) && r.includes(HEADER_AMOUNT)
  );
}

/** Parse the report from its rows, whichever container they arrived in. */
export function parseSalesReportGrid(rows: string[][]): FileProcessingResult {
  const errors: FileProcessingError[] = [];
  const warnings: FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];

  // Header-anchored: this supplier's ERP has already reshuffled the layout once
  const headerIdx = rows.findIndex(
    (r) => r.includes(HEADER_CUSTOMER) && r.includes(HEADER_AMOUNT)
  );
  if (headerIdx === -1) {
    errors.push(
      createFileProcessingError("PARSE_ERROR", {
        details: `Sales-report header row not found (expected "${HEADER_CUSTOMER}" + "${HEADER_AMOUNT}")`,
      })
    );
    legacyErrors.push("Sales-report header row not found");
    return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rows.length);
  }

  const header = rows[headerIdx];
  const monthCol = header.indexOf(HEADER_MONTH);
  const nameCol = header.indexOf(HEADER_CUSTOMER);
  const amountCol = header.indexOf(HEADER_AMOUNT);

  const customers = new Map<string, CustomerAccumulator>();
  const perMonthTotals = new Map<string, number>();
  let skippedRows = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    const name = (row[nameCol] ?? "").trim();
    const month = monthCol === -1 ? null : parseMonth(row[monthCol] ?? "");

    if (!name || !month) {
      skippedRows++;
      continue;
    }

    const amount = toNumber(row[amountCol] ?? "");
    const key = monthKey(month);
    perMonthTotals.set(key, (perMonthTotals.get(key) ?? 0) + amount);

    const existing = customers.get(name);
    if (existing) {
      existing.total += amount;
      if (!existing.latestDate || month > existing.latestDate) {
        existing.latestDate = month;
      }
    } else {
      customers.set(name, {
        name,
        total: amount,
        latestDate: month,
        firstRow: i + 1,
      });
    }
  }

  let totalGrossAmount = 0;
  let totalNetAmount = 0;
  let rowNumber = 0;

  for (const c of customers.values()) {
    const netAmount = roundAmount(c.total);
    if (netAmount === 0) {
      skippedRows++;
      continue;
    }

    if (netAmount < 0) {
      warnings.push(
        createFileProcessingError("NEGATIVE_AMOUNT", {
          rowNumber: c.firstRow,
          details: `זכיין "${c.name}" עם סכום שלילי: ${netAmount}`,
          value: String(netAmount),
        })
      );
    }

    const grossAmount = roundAmount(c.total * (1 + VAT_RATE));

    data.push({
      franchisee: c.name,
      date: c.latestDate,
      grossAmount,
      netAmount,
      originalAmount: netAmount,
      rowNumber: ++rowNumber,
    });

    totalGrossAmount += grossAmount;
    totalNetAmount += netAmount;
  }

  if (data.length === 0) {
    errors.push(
      createFileProcessingError("PARSE_ERROR", {
        details: "No customer rows could be extracted from the Yama VeKadma sales report",
      })
    );
    legacyErrors.push("No customer rows extracted from Yama VeKadma sales report");
    return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rows.length);
  }

  const result = createResult(
    true,
    data,
    errors,
    warnings,
    legacyErrors,
    legacyWarnings,
    rows.length,
    data.length,
    skippedRows,
    totalGrossAmount,
    totalNetAmount
  );

  const months = [...perMonthTotals.keys()];
  if (months.length > 1) {
    result.anomalies = [buildMonthRangeAnomaly(perMonthTotals)];
  }

  return result;
}

/**
 * The report's date range is picked by hand when it's exported, so a "Q2" file
 * can quietly carry a 4th month. List the months and their totals so the admin
 * can compare them against the period the file is being saved under.
 */
function buildMonthRangeAnomaly(perMonthTotals: Map<string, number>): Anomaly {
  const months = [...perMonthTotals.entries()].sort(([a], [b]) =>
    a.localeCompare(b)
  );
  return {
    code: "MIXED_PERIODS",
    severity: "warning",
    messageHe: `דוח ימה וקדמה מכיל ${months.length} חודשים: ${months
      .map(([m]) => monthLabel(m))
      .join(", ")} — יש לוודא שהטווח תואם את התקופה שנבחרה.`,
    details: {
      explanationHe:
        'טווח התאריכים של "ניתוח מכירות תקופתי" נבחר ידנית בעת הפקת הדוח, ולא בהכרח תואם את תקופת ההתחשבנות. כל שורות הקובץ נסכמות לעמלה — חודש עודף ינפח את החישוב וחודש חסר יחסיר ממנו.',
      monthlyTotals: months.map(([month, total]) => ({
        month: monthLabel(month),
        total: roundAmount(total),
      })),
    },
    suggestedActions: [
      {
        type: "acknowledge_only",
        labelHe: "בדקתי שהחודשים תואמים את התקופה",
      },
    ],
  };
}

function createResult(
  success: boolean,
  data: ParsedRowData[],
  errors: FileProcessingError[],
  warnings: FileProcessingError[],
  legacyErrors: string[],
  legacyWarnings: string[],
  totalRows: number,
  processedRows = 0,
  skippedRows = 0,
  totalGrossAmount = 0,
  totalNetAmount = 0
): FileProcessingResult {
  return {
    success,
    data,
    errors,
    warnings,
    legacyErrors,
    legacyWarnings,
    summary: {
      totalRows,
      processedRows,
      skippedRows,
      totalGrossAmount: roundAmount(totalGrossAmount),
      totalNetAmount: roundAmount(totalNetAmount),
      vatAdjusted: false,
    },
  };
}
