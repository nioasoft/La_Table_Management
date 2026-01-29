/**
 * Custom parser for אורן שיווק מיצים (OREN_JUICES) supplier files
 *
 * Problem: Very simple file with single franchisee and monthly amounts
 * Structure:
 *   - Row 1: Franchisee name (e.g., "מינה טומיי תל אביב")
 *   - Row 2: Headers - "חודש", "סכום"
 *   - Row 3+: Monthly amounts
 *
 * Key columns:
 *   - Row 1, Column A (0): Franchisee name
 *   - Column B (1): Monthly amount (starting from row 3)
 *
 * Logic: Extract franchisee name from row 1, sum all amounts for total
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

// Row configuration
const FRANCHISEE_ROW = 0; // Row 1 (0-indexed) - contains franchisee name
const HEADER_ROW = 1; // Row 2 (0-indexed) - contains headers
const DATA_START_ROW = 2; // Row 3 (0-indexed) - data starts here

// Column indices (0-based)
const MONTH_COL = 0; // Column A - חודש
const AMOUNT_COL = 1; // Column B - סכום

// Skip keywords
const SKIP_KEYWORDS = ["סה״כ", "סהכ", "סיכום", "total"];

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
 * Parse אורן שיווק מיצים supplier file
 */
export function parseOrenJuicesFile(buffer: Buffer): FileProcessingResult {
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

    // Extract franchisee name from row 1
    const franchiseeRow = rawData[FRANCHISEE_ROW] || [];
    let franchisee = String(franchiseeRow[0] || "").trim();

    // If first cell is empty, try to find franchisee name in any cell of first row
    if (!franchisee) {
      for (const cell of franchiseeRow) {
        const cellValue = String(cell || "").trim();
        if (cellValue && cellValue.length > 2 && !cellValue.match(/^\d/)) {
          franchisee = cellValue;
          break;
        }
      }
    }

    if (!franchisee) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Could not find franchisee name in the file",
        })
      );
      legacyErrors.push("Could not find franchisee name in the file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rawData.length);
    }

    // Sum all amounts from data rows
    let totalAmount = 0;
    let skippedRows = 0;
    let processedMonths = 0;

    for (let rowIdx = DATA_START_ROW; rowIdx < rawData.length; rowIdx++) {
      const row = rawData[rowIdx];
      if (!row || row.length === 0) {
        skippedRows++;
        continue;
      }

      const monthCell = String(row[MONTH_COL] || "").toLowerCase();

      // Skip summary rows
      if (SKIP_KEYWORDS.some((kw) => monthCell.includes(kw))) {
        skippedRows++;
        continue;
      }

      const amount = parseNumericValue(row[AMOUNT_COL]);
      if (amount !== 0) {
        totalAmount += amount;
        processedMonths++;
      } else {
        skippedRows++;
      }
    }

    if (totalAmount <= 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: `No valid amounts found for franchisee "${franchisee}"`,
        })
      );
      legacyErrors.push(`No valid amounts found for franchisee "${franchisee}"`);
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rawData.length);
    }

    // Amounts appear to include VAT
    const grossAmount = roundToTwoDecimals(totalAmount);
    const netAmount = roundToTwoDecimals(totalAmount / (1 + VAT_RATE));

    data.push({
      franchisee,
      date: null,
      grossAmount,
      netAmount,
      originalAmount: grossAmount,
      rowNumber: 1,
    });

    return createResult(
      true,
      data,
      errors,
      warnings,
      legacyErrors,
      legacyWarnings,
      rawData.length,
      1, // One franchisee
      skippedRows,
      grossAmount,
      netAmount
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
