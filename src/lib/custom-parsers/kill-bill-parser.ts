/**
 * Custom parser for קיל ביל (KILL_BILL) supplier files
 *
 * Problem: File has grouped structure where franchisee name appears only on first row of group
 * Structure:
 *   - Row 1: Period info (skip)
 *   - Row 2: Headers
 *   - Column A: Amount ("סכום במטבע החשבונית")
 *   - Column G: Franchisee name ("שם לקוח") - only on first row of each group
 *   - "סה"כ" rows mark end of each franchisee group (skip)
 *
 * The parser:
 *   1. Tracks the current franchisee name
 *   2. When a row has franchisee name in column G, switches to that franchisee
 *   3. When a row has empty column G (not a סה"כ row), adds amount to current franchisee
 *   4. Aggregates all amounts by franchisee
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundToTwoDecimals,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

// Column indices (0-based)
const AMOUNT_COL = 0; // Column A - סכום במטבע החשבונית
const FRANCHISEE_COL = 6; // Column G - שם לקוח

// Row configuration
const HEADER_ROW = 1; // Row 2 (0-indexed)
const DATA_START_ROW = 2; // Row 3 (0-indexed)

// Skip keywords (summary rows)
const SKIP_KEYWORDS = ['סה"כ', "סהכ", "total", "grand"];

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
 * Check if a row should be skipped (summary rows)
 */
function shouldSkipRow(row: unknown[]): boolean {
  const rowText = row.map((cell) => String(cell || "").toLowerCase()).join(" ");
  return SKIP_KEYWORDS.some((keyword) =>
    rowText.includes(keyword.toLowerCase())
  );
}

/**
 * Parse קיל ביל supplier file with aggregation by franchisee
 */
export function parseKillBillFile(buffer: Buffer): FileProcessingResult {
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

    if (!rawData || rawData.length < 3) {
      errors.push(createFileProcessingError("FILE_EMPTY"));
      legacyErrors.push("File is empty or too short");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    // Validate headers
    const headers = rawData[HEADER_ROW] || [];
    const amountHeader = String(headers[AMOUNT_COL] || "");
    const franchiseeHeader = String(headers[FRANCHISEE_COL] || "");

    // Log header validation for debugging
    if (!amountHeader.includes("סכום")) {
      warnings.push(
        createFileProcessingError("PARSE_ERROR", {
          details: `Expected amount column header at A, found: "${amountHeader}"`,
        })
      );
    }
    if (!franchiseeHeader.includes("לקוח")) {
      warnings.push(
        createFileProcessingError("PARSE_ERROR", {
          details: `Expected franchisee column header at G, found: "${franchiseeHeader}"`,
        })
      );
    }

    // Aggregate amounts by franchisee
    const franchiseeTotals: Map<string, { amount: number; rowCount: number; firstRow: number }> = new Map();
    let currentFranchisee: string | null = null;
    let skippedRows = 0;
    let totalRawRows = 0;

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

      totalRawRows++;

      // Extract values
      const franchiseeName = String(row[FRANCHISEE_COL] || "").trim();
      const amount = parseNumericValue(row[AMOUNT_COL]);

      // Update current franchisee if name is present
      if (franchiseeName) {
        currentFranchisee = franchiseeName;
      }

      // Skip if no current franchisee yet
      if (!currentFranchisee) {
        warnings.push(
          createFileProcessingError("EMPTY_FRANCHISEE_NAME", {
            rowNumber: rowIdx + 1,
            details: "Row found before any franchisee name",
          })
        );
        legacyWarnings.push(`Row ${rowIdx + 1}: No franchisee name found yet`);
        skippedRows++;
        continue;
      }

      // Skip rows with zero amount
      if (amount === 0) {
        warnings.push(
          createFileProcessingError("ZERO_AMOUNT", {
            rowNumber: rowIdx + 1,
            details: `Skipping row with zero amount for "${currentFranchisee}"`,
          })
        );
        skippedRows++;
        continue;
      }

      // Get or create franchisee totals
      const existing = franchiseeTotals.get(currentFranchisee) || {
        amount: 0,
        rowCount: 0,
        firstRow: rowIdx + 1,
      };

      // Add to totals (including negative amounts for returns/credits)
      existing.amount += amount;
      existing.rowCount++;

      franchiseeTotals.set(currentFranchisee, existing);
    }

    // Convert aggregated data to ParsedRowData
    let totalAmount = 0;
    let processedFranchisees = 0;
    let rowNumber = 1;

    for (const [franchisee, amounts] of franchiseeTotals.entries()) {
      // Skip franchisees with zero or negative total (after aggregation)
      if (amounts.amount <= 0) {
        warnings.push(
          createFileProcessingError("NEGATIVE_AMOUNT", {
            rowNumber: amounts.firstRow,
            details: `Franchisee "${franchisee}" has non-positive total after aggregation: ${amounts.amount} (${amounts.rowCount} rows)`,
            value: String(amounts.amount),
          })
        );
        continue;
      }

      // Kill Bill amounts appear to include VAT based on common practice
      const grossAmount = roundToTwoDecimals(amounts.amount);
      const netAmount = roundToTwoDecimals(amounts.amount / 1.18); // Remove VAT for net

      data.push({
        franchisee,
        date: null,
        grossAmount,
        netAmount,
        originalAmount: grossAmount,
        rowNumber: rowNumber++,
      });

      totalAmount += grossAmount;
      processedFranchisees++;
    }

    if (processedFranchisees === 0) {
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
      processedFranchisees,
      skippedRows,
      totalAmount,
      roundToTwoDecimals(totalAmount / 1.18)
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
