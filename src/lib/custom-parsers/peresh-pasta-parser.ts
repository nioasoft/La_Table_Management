/**
 * Custom parser for פרש פסטה (PERESH_PASTA) supplier files
 *
 * Format: an accounting export — "מכירות <year> לפי לקוח (כספי) - רבעוני".
 * Structure of the sample Q2-2026 file (single sheet, A1:G14):
 *   Row 0: supplier legal name
 *   Row 1: report title
 *   Row 2: headers — E=מפתח (account code), F=שם חשבון, G=רבעון2
 *   Rows 4-10: one row per customer, amount NEGATIVE (sales are a credit balance)
 *   Row 12: totals row (amount only, no name)
 *   Row 13: commission row — 0.1 (=10%) sits in the NAME column, amount in the amount column
 *
 * Three traps this parser guards against:
 *  1. Amounts are negative → sign is flipped (not abs()), so a genuine refund
 *     stays negative and gets skipped with a warning.
 *  2. The commission row puts "0.1" in the name column — without filtering it
 *     would create a franchisee literally named "0.1".
 *  3. Data starts at column E and the geometry shifts between exports, so
 *     columns are located by header text, never by fixed index.
 *
 * Commission is NOT pre-calculated here: the supplier is a flat-percentage
 * supplier, so the system applies default_commission_rate (+ exceptions).
 */

import * as XLSX from "xlsx";
import {
  calculateGrossFromNet,
  type FileProcessingResult,
  type ParsedRowData,
  roundAmount,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";
import type { FileProcessingError } from "../file-processing-errors";

const HEADER_SCAN_LIMIT = 15;
const NAME_HEADER = "שם חשבון";
/** Tolerance (₪) when validating parsed rows against the file's own totals row */
const TOTAL_TOLERANCE = 1;

/** Parse a numeric cell value; returns null when the cell isn't a number */
function parseNumericValue(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return isNaN(value) ? null : value;

  const cleaned = String(value)
    .replace(/[₪$€£¥,\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1")
    .trim();

  if (!cleaned || !/^-?\d*\.?\d+$/.test(cleaned)) return null;
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

/** A cell is a franchisee name only if it's non-empty and not a bare number */
function isNameCell(value: unknown): boolean {
  const str = String(value ?? "").trim();
  return str.length > 0 && parseNumericValue(str) === null;
}

export function parsePereshPastaFile(
  buffer: Buffer,
  vatRate?: number
): FileProcessingResult {
  const errors: FileProcessingError[] = [];
  const warnings: FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];

  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    if (workbook.SheetNames.length === 0) {
      errors.push(createFileProcessingError("NO_WORKSHEETS"));
      legacyErrors.push("No worksheets found in file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: null,
    });

    // 1. Locate the header row by its "שם חשבון" cell
    const headerRowIdx = rows
      .slice(0, HEADER_SCAN_LIMIT)
      .findIndex(row => row?.some(c => String(c ?? "").trim().includes(NAME_HEADER)));

    if (headerRowIdx < 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: `לא נמצאה שורת כותרות עם "${NAME_HEADER}" ב-${HEADER_SCAN_LIMIT} השורות הראשונות`,
        })
      );
      legacyErrors.push(`Header row with "${NAME_HEADER}" not found`);
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rows.length);
    }

    const headers = rows[headerRowIdx];
    const nameCol = headers.findIndex(c => String(c ?? "").trim().includes(NAME_HEADER));
    const dataRows = rows.slice(headerRowIdx + 1);

    // 2. Amount column: a headed column right of the name column that holds
    //    numbers on the actual data rows. A full-year export has רבעון1..רבעון4;
    //    take the last one but say so loudly — silently picking wrong is a money bug.
    const amountCandidates: number[] = [];
    for (let col = nameCol + 1; col < headers.length; col++) {
      if (!String(headers[col] ?? "").trim()) continue;
      const hasNumbers = dataRows.some(
        row => isNameCell(row?.[nameCol]) && parseNumericValue(row?.[col]) !== null
      );
      if (hasNumbers) amountCandidates.push(col);
    }

    if (amountCandidates.length === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: `לא נמצאה עמודת סכומים מימין לעמודת "${NAME_HEADER}"`,
        })
      );
      legacyErrors.push("No numeric amount column found right of the name column");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rows.length);
    }

    const amountCol = amountCandidates[amountCandidates.length - 1];
    if (amountCandidates.length > 1) {
      const names = amountCandidates.map(c => String(headers[c] ?? "").trim());
      warnings.push(
        createFileProcessingError("PARSE_ERROR", {
          rowNumber: headerRowIdx + 1,
          details: `נמצאו ${amountCandidates.length} עמודות סכום (${names.join(", ")}) — נבחרה האחרונה: "${names[names.length - 1]}"`,
        })
      );
      legacyWarnings.push(
        `Multiple amount columns found (${names.join(", ")}); used the last one`
      );
    }

    // 3. Data rows + the file's own totals row (amount, no name)
    let totalNetAmount = 0;
    let totalGrossAmount = 0;
    let skippedRows = 0;
    let fileTotal: number | null = null;

    for (let i = 0; i < dataRows.length; i++) {
      const row = dataRows[i];
      const rawAmount = parseNumericValue(row?.[amountCol]);

      if (!isNameCell(row?.[nameCol])) {
        // Totals row: an amount with no name. Keep the last one seen — the
        // commission row that follows it is filtered out by isNameCell above.
        if (rawAmount !== null && fileTotal === null) fileTotal = rawAmount;
        skippedRows++;
        continue;
      }

      const franchisee = String(row[nameCol]).trim();
      const rowNumber = headerRowIdx + i + 2; // 1-based sheet row

      if (rawAmount === null) {
        skippedRows++;
        continue;
      }

      // Sales are credited → negative in the ledger. Flip the sign so a real
      // refund (positive in the file) comes out negative and is skipped below.
      const amount = -rawAmount;
      if (amount <= 0) {
        warnings.push(
          createFileProcessingError("NEGATIVE_AMOUNT", {
            rowNumber,
            details: `"${franchisee}" עם סכום לא-חיובי: ${amount}`,
            value: String(amount),
          })
        );
        skippedRows++;
        continue;
      }

      const netAmount = roundAmount(amount);
      const grossAmount = roundAmount(calculateGrossFromNet(amount, vatRate));

      data.push({
        franchisee,
        date: null,
        grossAmount,
        netAmount,
        originalAmount: netAmount,
        rowNumber: data.length + 1,
      });

      totalNetAmount += netAmount;
      totalGrossAmount += grossAmount;
    }

    if (data.length === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "לא נמצאו שורות לקוח בקובץ",
        })
      );
      legacyErrors.push("No customer rows found in the file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rows.length);
    }

    // 4. Cross-check against the file's own totals row — catches a wrong
    //    amount-column pick, which would otherwise be silent and wrong.
    if (fileTotal !== null) {
      const expected = Math.abs(fileTotal);
      if (Math.abs(expected - totalNetAmount) > TOTAL_TOLERANCE) {
        warnings.push(
          createFileProcessingError("PARSE_ERROR", {
            details: `סכום השורות (${roundAmount(totalNetAmount)}) שונה משורת הסה"כ בקובץ (${roundAmount(expected)})`,
          })
        );
        legacyWarnings.push(
          `Parsed total ${roundAmount(totalNetAmount)} differs from file total ${roundAmount(expected)}`
        );
      }
    }

    return createResult(
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
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    errors.push(createFileProcessingError("SYSTEM_ERROR", { details: message }));
    legacyErrors.push(message);
    return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
  }
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
