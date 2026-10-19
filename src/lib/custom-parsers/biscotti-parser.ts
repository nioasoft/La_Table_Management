/**
 * Custom parser for ביסקוטי (supplier code "ביסקוטי") sales reports.
 *
 * Flat layout, one sheet ("DataSheet"), first seen Q3-2026:
 *   רשת | מס' לקוח | שם לקוח | חודש | סכום (ש'ח)
 *   - One row per customer per month; a file may hold several months
 *     (e.g. Mina Haifa Aug + Sep in one export).
 *   - חודש is text like "אוג-26" (or a real Excel date in other exports).
 *   - סכום is NET (supplier vat_included=false); gross = net × (1 + vatRate).
 *
 * Columns are located by header text, not index. Each row is dated to the
 * last day of its month so the upload route derives the period from content.
 *
 * מס' לקוח is Biscotti's own customer number, NOT a ח.פ — it is deliberately
 * not passed as `franchiseeId`, which the matcher treats as a business ID
 * (and the review modal would offer to overwrite the franchisee's ח.פ with it).
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  ISRAEL_VAT_RATE,
  roundAmount,
} from "../file-processor";
import {
  type FileProcessingError,
  createFileProcessingError,
} from "../file-processing-errors";

const HEADER_SCAN_ROWS = 10;
const NAME_HEADER = "שם לקוח";

/** First three letters of the Hebrew month abbreviation → month index */
const HEBREW_MONTHS: Record<string, number> = {
  ינו: 0, פבר: 1, מרץ: 2, מרס: 2, אפר: 3, מאי: 4, יונ: 5,
  יול: 6, אוג: 7, ספט: 8, אוק: 9, נוב: 10, דצמ: 11,
};

const HEBREW_MONTH_RE = /^([א-ת]{3})[א-ת]*['׳]?\s*[-/\s]\s*(\d{2}|\d{4})$/;

/** Excel serial for 1970-01-01 */
const EXCEL_EPOCH_OFFSET = 25569;

/** Last day of the month, local time (never toISOString — Israel TZ) */
function monthEnd(year: number, month: number): Date {
  return new Date(year, month + 1, 0);
}

/**
 * "אוג-26" / "ספטמבר 2026" / Excel serial → last day of that month.
 * Serials are converted by hand: cellDates:true shifts by the runtime TZ and
 * XLSX.SSF is undefined under this repo's `import * as XLSX` interop.
 */
function parseMonth(value: unknown): Date | null {
  if (typeof value === "number" && Number.isFinite(value) && value > 0) {
    // ponytail: round to whole days — a month cell never carries a time
    const utc = new Date((Math.round(value) - EXCEL_EPOCH_OFFSET) * 86_400_000);
    return monthEnd(utc.getUTCFullYear(), utc.getUTCMonth());
  }
  const match = String(value ?? "").trim().match(HEBREW_MONTH_RE);
  if (!match) return null;
  const month = HEBREW_MONTHS[match[1]];
  if (month === undefined) return null;
  const year = parseInt(match[2], 10);
  return monthEnd(year < 100 ? 2000 + year : year, month);
}

function toNumber(value: unknown): number | null {
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value ?? "").replace(/[,₪\s]/g, "");
  if (!cleaned || cleaned === "-") return null;
  const parsed = parseFloat(cleaned);
  return Number.isNaN(parsed) ? null : parsed;
}

const cellText = (value: unknown): string => String(value ?? "").trim();

export function parseBiscottiFile(
  buffer: Buffer,
  vatRate: number = ISRAEL_VAT_RATE
): FileProcessingResult {
  const errors: FileProcessingError[] = [];
  const warnings: FileProcessingError[] = [];
  const data: ParsedRowData[] = [];
  const fail = (code: "NO_WORKSHEETS" | "HEADER_ROW_NOT_FOUND" | "PARSE_ERROR" | "SYSTEM_ERROR", details: string, totalRows = 0) => {
    errors.push(createFileProcessingError(code, { details }));
    return createResult(false, data, errors, warnings, totalRows);
  };

  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return fail("NO_WORKSHEETS", "No worksheets found in file");

    const rows: unknown[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: true,
      defval: "",
    });

    const headerIdx = rows
      .slice(0, HEADER_SCAN_ROWS)
      .findIndex((r) => (r || []).some((c) => cellText(c) === NAME_HEADER));
    if (headerIdx === -1) {
      return fail("HEADER_ROW_NOT_FOUND", `Header row with a "${NAME_HEADER}" column not found`, rows.length);
    }

    const header = rows[headerIdx].map(cellText);
    const nameCol = header.indexOf(NAME_HEADER);
    const monthCol = header.findIndex((h) => h.startsWith("חודש"));
    const amountCol = header.findIndex((h) => h.startsWith("סכום"));
    if (monthCol === -1 || amountCol === -1) {
      return fail("HEADER_ROW_NOT_FOUND", `Missing "חודש" or "סכום" column in header: ${header.join(" | ")}`, rows.length);
    }

    let totalNet = 0;
    let totalGross = 0;
    let skippedRows = 0;

    for (let i = headerIdx + 1; i < rows.length; i++) {
      const row = rows[i] || [];
      const franchisee = cellText(row[nameCol]);
      const net = toNumber(row[amountCol]);
      if (!franchisee || franchisee.startsWith('סה"כ') || franchisee.startsWith("סה״כ") || !net) {
        skippedRows++;
        continue;
      }

      const date = parseMonth(row[monthCol]);
      if (!date) {
        warnings.push(
          createFileProcessingError("INVALID_DATE", {
            details: `Unreadable month "${cellText(row[monthCol])}" for ${franchisee}`,
            rowNumber: i + 1,
          })
        );
      }

      const netAmount = roundAmount(net);
      const grossAmount = roundAmount(net * (1 + vatRate));
      data.push({
        franchisee,
        date,
        grossAmount,
        netAmount,
        originalAmount: netAmount,
        rowNumber: i + 1,
      });
      totalNet += netAmount;
      totalGross += grossAmount;
    }

    if (data.length === 0) {
      return fail("PARSE_ERROR", "Could not extract any customer rows from the file", rows.length);
    }

    return createResult(true, data, errors, warnings, rows.length, skippedRows, totalGross, totalNet);
  } catch (error) {
    return fail("SYSTEM_ERROR", error instanceof Error ? error.message : "Unknown error");
  }
}

function createResult(
  success: boolean,
  data: ParsedRowData[],
  errors: FileProcessingError[],
  warnings: FileProcessingError[],
  totalRows: number,
  skippedRows = 0,
  totalGrossAmount = 0,
  totalNetAmount = 0
): FileProcessingResult {
  return {
    success,
    data,
    errors,
    warnings,
    legacyErrors: errors.map((e) => e.details ?? e.message),
    legacyWarnings: warnings.map((w) => w.details ?? w.message),
    summary: {
      totalRows,
      processedRows: data.length,
      skippedRows,
      totalGrossAmount: roundAmount(totalGrossAmount),
      totalNetAmount: roundAmount(totalNetAmount),
      vatAdjusted: false,
    },
  };
}
