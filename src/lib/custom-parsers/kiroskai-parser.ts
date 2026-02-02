/**
 * Custom parser for קירוסקאי (KIROSKAI) supplier files
 *
 * Problem: Simple table with pre-calculated commission
 * Structure:
 *   - Row 1: Metadata (supplier info)
 *   - Row 2: Headers - "מס' לקוח", "שם הלקוח", months, "סכום כולל", "עמלה"
 *   - Row 3+: Data rows
 *
 * Key columns:
 *   - Column B (1): Franchisee name ("שם הלקוח")
 *   - Column I (8): Total amount ("סכום כולל") - for cross-reference
 *   - Column J (9): Pre-calculated commission ("עמלה")
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundToTwoDecimals,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

// VAT rate in Israel
const VAT_RATE = 0.18;

// Column indices (0-based)
const FRANCHISEE_COL = 1; // Column B - שם הלקוח
const TOTAL_AMOUNT_COL = 8; // Column I - סכום כולל
const COMMISSION_COL = 9; // Column J - עמלה

// Row configuration
const HEADER_ROW = 1; // Row 2 (0-indexed) - "שם הלקוח" header
const DATA_START_ROW = 2; // Row 3 (0-indexed) - data starts here

// Skip keywords - rows with these values should be skipped
const SKIP_KEYWORDS = ["סה״כ", "סהכ", "סיכום", "total", "סכום כולל"];

/**
 * Parse a numeric value from cell content
 */
function parseNumericValue(value: unknown): number {
  if (value === null || value === undefined) return 0;
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
 * Check if a row should be skipped (summary rows, etc.)
 */
function shouldSkipRow(row: unknown[]): boolean {
  const rowText = row.map((cell) => String(cell || "").toLowerCase()).join(" ");
  return SKIP_KEYWORDS.some((keyword) => rowText.includes(keyword.toLowerCase()));
}

/**
 * Parse קירוסקאי supplier file
 */
export function parseKiroskaiFile(buffer: Buffer): FileProcessingResult {
  const errors: import("../file-processing-errors").FileProcessingError[] = [];
  const warnings: import("../file-processing-errors").FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];

  try {
    // Read the workbook
    const workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
    });

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      errors.push(createFileProcessingError("NO_WORKSHEETS"));
      legacyErrors.push("No worksheets found in file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    const sheet = workbook.Sheets[sheetName];
    const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });

    if (!rawData || rawData.length < DATA_START_ROW + 1) {
      errors.push(createFileProcessingError("FILE_EMPTY"));
      legacyErrors.push("File is empty or too short");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    // Validate headers
    const headers = rawData[HEADER_ROW] || [];
    const franchiseeHeader = String(headers[FRANCHISEE_COL] || "").trim();
    const totalHeader = String(headers[TOTAL_AMOUNT_COL] || "").trim();

    if (!franchiseeHeader.includes("לקוח") && !franchiseeHeader.includes("שם")) {
      warnings.push(
        createFileProcessingError("PARSE_ERROR", {
          details: `Expected franchisee header at column B, found: "${franchiseeHeader}"`,
        })
      );
    }

    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let skippedRows = 0;
    let rowNumber = 1;

    // Process data rows
    for (let rowIdx = DATA_START_ROW; rowIdx < rawData.length; rowIdx++) {
      const row = rawData[rowIdx];
      if (!row || row.length === 0) {
        skippedRows++;
        continue;
      }

      // Skip summary rows
      if (shouldSkipRow(row)) {
        skippedRows++;
        continue;
      }

      const franchisee = String(row[FRANCHISEE_COL] || "").trim();
      if (!franchisee) {
        skippedRows++;
        continue;
      }

      const totalAmount = parseNumericValue(row[TOTAL_AMOUNT_COL]);
      const commission = parseNumericValue(row[COMMISSION_COL]);

      // Skip rows with zero amounts only - include negative amounts (credits/refunds)
      if (totalAmount === 0) {
        skippedRows++;
        continue;
      }

      // Total amount appears to include VAT, so calculate net
      const grossAmount = roundToTwoDecimals(totalAmount);
      const netAmount = roundToTwoDecimals(totalAmount / (1 + VAT_RATE));
      const preCalculatedCommission = roundToTwoDecimals(commission);

      data.push({
        franchisee,
        date: null,
        grossAmount,
        netAmount,
        originalAmount: grossAmount,
        rowNumber: rowNumber++,
        preCalculatedCommission,
      });

      totalGrossAmount += grossAmount;
      totalNetAmount += netAmount;
      processedRows++;
    }

    if (processedRows === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Could not extract any franchisee data from the file",
        })
      );
      legacyErrors.push("Could not extract any franchisee data from the file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rawData.length);
    }

    return createResult(
      true,
      data,
      errors,
      warnings,
      legacyErrors,
      legacyWarnings,
      rawData.length,
      processedRows,
      skippedRows,
      totalGrossAmount,
      totalNetAmount
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
      totalGrossAmount: roundToTwoDecimals(totalGrossAmount),
      totalNetAmount: roundToTwoDecimals(totalNetAmount),
      vatAdjusted: true,
    },
  };
}
