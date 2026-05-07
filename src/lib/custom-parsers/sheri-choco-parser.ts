/**
 * Custom parser for שרי שוקו (SHERI_CHOCO) supplier files
 *
 * File structure: workbook with up to three sheets, all sharing the same
 * column layout. Each sheet contains one transaction per row.
 *
 *   Sheet 1: "חשבונית מס"        — tax invoices (VAT column may be 0)
 *   Sheet 2: "חשבונית מס זיכוי"  — credit invoices (amounts already negative)
 *   Sheet 3: "חשבונית - מס"      — tax invoices that include VAT
 *
 * Columns (identical across sheets):
 *   A (0): מספר מסמך   — document number
 *   B (1): תאריך       — date as DD/MM/YY string
 *   C (2): קוד לקוח    — internal customer code or business ID
 *   D (3): שם לקוח     — franchisee display name (used for matching)
 *   E (4): ללא מע"מ    — net amount (pre-VAT) — used as netAmount
 *   F (5): מע"מ        — VAT amount
 *   G (6): סה"כ        — gross amount (includes VAT) — used as grossAmount
 *
 * The supplier is configured with vatIncluded=false, so the file's pre-VAT
 * column drives the commission calculation. Each invoice is emitted as its
 * own row so reconciliation can bucket commissions into the correct period.
 * Credit-invoice rows arrive already negative and are preserved as-is.
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundAmount,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

// Column indices (0-based) — consistent across all three sheets
const DOC_NUMBER_COL = 0;
const DATE_COL = 1;
const CUSTOMER_CODE_COL = 2;
const CUSTOMER_NAME_COL = 3;
const NET_COL = 4;
const VAT_COL = 5;
const GROSS_COL = 6;

// Sheet names that contain transaction rows
const TRANSACTION_SHEETS = new Set([
  "חשבונית מס",
  "חשבונית מס זיכוי",
  "חשבונית - מס",
]);

/**
 * Parse a numeric value from cell content.
 * Strips currency symbols, commas, whitespace and handles parenthesised negatives.
 */
function parseNumericValue(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  if (typeof value === "number") return isNaN(value) ? 0 : value;

  let strValue = String(value).trim();
  strValue = strValue
    .replace(/[₪$€£¥]/g, "")
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .trim();

  if (strValue.startsWith("(") && strValue.endsWith(")")) {
    strValue = "-" + strValue.slice(1, -1);
  }

  const parsed = parseFloat(strValue);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Parse the supplier's date format: "DD/MM/YY" or "DD/MM/YYYY".
 * Returns null if the value cannot be interpreted as a real date.
 *
 * 2-digit years are interpreted as 2000+YY (the supplier's data is
 * post-2000 by definition).
 */
function parseSheriDate(value: unknown): Date | null {
  if (value === null || value === undefined || value === "") return null;

  if (value instanceof Date && !isNaN(value.getTime())) {
    return value;
  }

  const str = String(value).trim();
  if (!str) return null;

  const match = str.match(/^(\d{1,2})\/(\d{1,2})\/(\d{2}|\d{4})$/);
  if (!match) return null;

  const day = parseInt(match[1], 10);
  const month = parseInt(match[2], 10);
  let year = parseInt(match[3], 10);
  if (match[3].length === 2) year = 2000 + year;

  if (
    isNaN(day) ||
    isNaN(month) ||
    isNaN(year) ||
    day < 1 ||
    day > 31 ||
    month < 1 ||
    month > 12
  ) {
    return null;
  }

  // Use UTC to keep the date intent (DD/MM/YYYY) intact across timezones.
  const date = new Date(Date.UTC(year, month - 1, day));
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Detect a header row by looking for the canonical "ללא מע"מ" header
 * (or any of the other text headers) in the expected columns.
 */
function isHeaderRow(row: unknown[]): boolean {
  const docCell = String(row[DOC_NUMBER_COL] ?? "").trim();
  const netCell = String(row[NET_COL] ?? "").trim();
  return docCell === "מספר מסמך" || netCell.includes("ללא מע");
}

/**
 * Parse שרי שוקו supplier file (workbook with one or more invoice sheets).
 */
export function parseSheriChocoFile(buffer: Buffer): FileProcessingResult {
  const errors: import("../file-processing-errors").FileProcessingError[] = [];
  const warnings: import("../file-processing-errors").FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];

  try {
    const workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
    });

    if (workbook.SheetNames.length === 0) {
      errors.push(createFileProcessingError("NO_WORKSHEETS"));
      legacyErrors.push("No worksheets found in file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let skippedRows = 0;
    let totalRowsSeen = 0;
    let outRowNumber = 1;
    let hasPartialVat = false;

    // Iterate every sheet whose name matches a known invoice-sheet label.
    // We intentionally tolerate small variations (extra spaces, hyphens) by
    // also accepting any sheet whose name contains "חשבונית".
    for (const sheetName of workbook.SheetNames) {
      const trimmedName = sheetName.trim();
      const isKnownSheet =
        TRANSACTION_SHEETS.has(trimmedName) || trimmedName.includes("חשבונית");
      if (!isKnownSheet) continue;

      const sheet = workbook.Sheets[sheetName];
      const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: "",
      });

      if (!rawData || rawData.length === 0) continue;

      for (let rowIdx = 0; rowIdx < rawData.length; rowIdx++) {
        const row = rawData[rowIdx];
        if (!row || row.length === 0) continue;

        // Skip header rows (the first row, plus any stray repeats)
        if (isHeaderRow(row)) continue;

        const customerName = String(row[CUSTOMER_NAME_COL] ?? "").trim();
        if (!customerName) continue;

        totalRowsSeen++;

        const netAmount = parseNumericValue(row[NET_COL]);
        const grossAmount = parseNumericValue(row[GROSS_COL]);
        const vatAmount = parseNumericValue(row[VAT_COL]);

        // Drop rows with no monetary content at all (e.g. stray summary rows).
        if (netAmount === 0 && grossAmount === 0 && vatAmount === 0) {
          skippedRows++;
          continue;
        }

        // The supplier is vat_exempt in our system. The blanket
        // gross=net override would otherwise overwrite the third sheet's
        // VAT-inclusive totals; signal that we intentionally preserve them.
        if (Math.abs(grossAmount - netAmount) > 0.01) {
          hasPartialVat = true;
        }

        const customerCode = String(row[CUSTOMER_CODE_COL] ?? "").trim();
        const date = parseSheriDate(row[DATE_COL]);

        const roundedNet = roundAmount(netAmount);
        const roundedGross = roundAmount(grossAmount);

        data.push({
          franchisee: customerName,
          franchiseeId: customerCode || undefined,
          date,
          grossAmount: roundedGross,
          netAmount: roundedNet,
          originalAmount: roundedNet,
          rowNumber: outRowNumber++,
        });

        totalNetAmount += roundedNet;
        totalGrossAmount += roundedGross;
        processedRows++;
      }
    }

    if (processedRows === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details:
            "Could not extract any invoice rows from the file. Expected sheets: 'חשבונית מס', 'חשבונית מס זיכוי', 'חשבונית - מס'.",
        })
      );
      legacyErrors.push("Could not extract any invoice rows from the file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, totalRowsSeen);
    }

    return createResult(
      true,
      data,
      errors,
      warnings,
      legacyErrors,
      legacyWarnings,
      totalRowsSeen,
      processedRows,
      skippedRows,
      totalGrossAmount,
      totalNetAmount,
      hasPartialVat
    );
  } catch (error) {
    errors.push(
      createFileProcessingError("SYSTEM_ERROR", {
        details: error instanceof Error ? error.message : "Unknown error",
      })
    );
    legacyErrors.push(error instanceof Error ? error.message : "Unknown error");
    return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
  }
}

function createResult(
  success: boolean,
  data: ParsedRowData[],
  errors: import("../file-processing-errors").FileProcessingError[],
  warnings: import("../file-processing-errors").FileProcessingError[],
  legacyErrors: string[],
  legacyWarnings: string[],
  totalRows: number,
  processedRows = 0,
  skippedRows = 0,
  totalGrossAmount = 0,
  totalNetAmount = 0,
  hasPartialVat = false
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
      hasPartialVat,
    },
  };
}
