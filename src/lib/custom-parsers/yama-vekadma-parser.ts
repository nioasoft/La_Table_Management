/**
 * Custom parser for ימה וקדמה (YAMA_VEKADMA) supplier files
 *
 * File structure:
 *   This is an account ledger (כרטסת) format with transactions grouped by franchisee.
 *
 *   - Row 0: Headers (שנה, ת מסמך, ת פרעון, סוג, מסמך, פרטים, אסמכתה, חובה, זכות, יתרה)
 *   - Franchisee names appear as standalone rows (e.g., "קינג קונג חורב בע\"מ")
 *   - Transaction rows follow each franchisee with amounts in column H (חובה)
 *   - Each franchisee section may end with "סך הכל" row
 *   - File ends with "סך הכל כל הסניפים" row
 *
 * Solution:
 *   - Identify franchisee header rows (rows that contain a franchisee name pattern)
 *   - Sum the "חובה" (debit) column for each franchisee's transactions
 *   - Skip negative amounts (returns/credits)
 *   - Extract the franchisee name from the header row
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundToTwoDecimals,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

// Column indices (0-based)
const YEAR_COL = 0; // Column A - שנה
const DEBIT_COL = 7; // Column H - חובה
const TOTAL_COL = 6; // Column G - אסמכתה (where "סך הכל" appears)

// VAT rate in Israel
const VAT_RATE = 0.18;

// Patterns to identify franchisee name rows
// These contain the business name but NOT transaction data
// Any row containing one of these patterns (and not being a data row) is a franchisee header
const FRANCHISEE_PATTERNS = [
  /קינג קונג/i,
  /מינה טומ/i,
  /פט ויני/i,
  /פאט ויני/i,
  /בע"מ/i,
  /בעמ/i,
  /^\d+\s*-\s*.+/, // Pattern like "428757 - קינג קונג סניף קרית אתא" (customer ID - name)
];

// Patterns to skip (total rows, sub-headers, etc.)
const SKIP_PATTERNS = [
  /סך הכל/i,
  /סה"כ/i,
  /יתרה/i,
  /^שנה\s*$/i,
];

// Patterns that indicate area markers (standalone location names, not franchisee names)
// These are rows that just contain a location name without business entity suffix
const AREA_MARKERS = [
  "נהריה אין",
  "חדרה",
];

interface FranchiseeData {
  name: string;
  totalDebit: number;
  rowCount: number;
  firstRow: number;
}

/**
 * Parse a numeric value from cell content
 */
function parseNumericValue(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return isNaN(value) ? 0 : value;

  let strValue = String(value).trim();

  // Remove currency symbols, commas, spaces
  strValue = strValue
    .replace(/[₪$€£¥]/g, "")
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .trim();

  // Handle negative numbers in parentheses: (1,234) -> -1234
  if (strValue.startsWith("(") && strValue.endsWith(")")) {
    strValue = "-" + strValue.slice(1, -1);
  }

  // Handle dash for zero
  if (strValue === "-" || strValue === "") return 0;

  const parsed = parseFloat(strValue);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Check if a row is a franchisee header row
 * A franchisee header row contains a business name but no transaction data
 */
function isFranchiseeHeaderRow(row: unknown[]): boolean {
  const firstCell = String(row[0] || "").trim();

  // Skip if it's a skip pattern
  for (const pattern of SKIP_PATTERNS) {
    if (pattern.test(firstCell)) return false;
  }

  // Check if first cell matches franchisee patterns
  for (const pattern of FRANCHISEE_PATTERNS) {
    if (pattern.test(firstCell)) {
      // Also verify it's not a data row (no year in column A)
      const yearMatch = /^\d{4}$/.test(firstCell);
      if (!yearMatch) {
        return true;
      }
    }
  }

  return false;
}

/**
 * Check if a row is a data row (has transaction data)
 */
function isDataRow(row: unknown[]): boolean {
  const firstCell = String(row[0] || "").trim();

  // Data rows have a year in column A (e.g., "2025")
  if (/^\d{4}$/.test(firstCell)) {
    return true;
  }

  return false;
}

/**
 * Check if a row is a section total row
 */
function isTotalRow(row: unknown[]): boolean {
  // Check if any cell contains "סך הכל"
  for (const cell of row) {
    const cellStr = String(cell || "").trim();
    if (cellStr.includes("סך הכל") || cellStr.includes("סה\"כ")) {
      return true;
    }
  }
  return false;
}

/**
 * Check if row is an area marker (not a franchisee name but just area indicator)
 * These are standalone rows with just a location name like "חדרה" or "נהריה אין"
 */
function isAreaMarker(row: unknown[]): boolean {
  const firstCell = String(row[0] || "").trim();

  // Area markers are exact matches or have trailing space
  for (const marker of AREA_MARKERS) {
    if (firstCell === marker || firstCell === marker + " ") {
      return true;
    }
  }

  return false;
}

/**
 * Extract clean franchisee name from a row
 */
function extractFranchiseeName(row: unknown[]): string {
  const firstCell = String(row[0] || "").trim();

  // Remove customer ID prefix if present (e.g., "428654 - קינג קונג חורב בע\"מ")
  let name = firstCell.replace(/^\d+\s*-\s*/, "");

  // Clean up extra spaces
  name = name.replace(/\s+/g, " ").trim();

  return name;
}

/**
 * Parse ימה וקדמה supplier file (account ledger format)
 */
export function parseYamaVekadmaFile(buffer: Buffer): FileProcessingResult {
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

    if (!rawData || rawData.length < 2) {
      errors.push(createFileProcessingError("FILE_EMPTY"));
      legacyErrors.push("File is empty or too short");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    // Process the file to find franchisee sections
    const franchisees: FranchiseeData[] = [];
    let currentFranchisee: FranchiseeData | null = null;
    let skippedRows = 0;

    for (let rowIdx = 1; rowIdx < rawData.length; rowIdx++) {
      const row = rawData[rowIdx];
      if (!row || row.every(cell => cell === "" || cell === null || cell === undefined)) {
        continue;
      }

      // Skip area markers
      if (isAreaMarker(row)) {
        continue;
      }

      // Check if this is a franchisee header row
      if (isFranchiseeHeaderRow(row)) {
        // Save previous franchisee if exists (even with zero/negative - we'll filter later)
        if (currentFranchisee) {
          franchisees.push(currentFranchisee);
        }

        // Start new franchisee
        currentFranchisee = {
          name: extractFranchiseeName(row),
          totalDebit: 0,
          rowCount: 0,
          firstRow: rowIdx + 1,
        };
        continue;
      }

      // Check if this is a total row (end of section)
      if (isTotalRow(row)) {
        // We can optionally verify the total here
        continue;
      }

      // Check if this is a data row
      if (isDataRow(row) && currentFranchisee) {
        const debitAmount = parseNumericValue(row[DEBIT_COL]);

        // Include all amounts (positive for debits, negative for credits/returns)
        currentFranchisee.totalDebit += debitAmount;
        currentFranchisee.rowCount++;
      }
    }

    // Don't forget the last franchisee
    if (currentFranchisee) {
      franchisees.push(currentFranchisee);
    }

    // Convert franchisee data to ParsedRowData
    let totalNetAmount = 0;
    let totalGrossAmount = 0;
    let processedRows = 0;
    let rowNumber = 1;

    for (const franchisee of franchisees) {
      // Skip franchisees with zero total (no activity)
      if (franchisee.totalDebit === 0) {
        skippedRows++;
        continue;
      }

      // Warn about negative amounts but still include them
      if (franchisee.totalDebit < 0) {
        warnings.push(
          createFileProcessingError("NEGATIVE_AMOUNT", {
            rowNumber: franchisee.firstRow,
            details: `זכיין "${franchisee.name}" עם סכום שלילי: ${franchisee.totalDebit}`,
            value: String(franchisee.totalDebit),
          })
        );
      }

      // Amounts appear to include VAT based on the file structure
      const grossAmount = roundToTwoDecimals(franchisee.totalDebit);
      const netAmount = roundToTwoDecimals(grossAmount / (1 + VAT_RATE));

      data.push({
        franchisee: franchisee.name,
        date: null,
        grossAmount,
        netAmount,
        originalAmount: grossAmount,
        rowNumber: rowNumber++,
      });

      totalNetAmount += netAmount;
      totalGrossAmount += grossAmount;
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
