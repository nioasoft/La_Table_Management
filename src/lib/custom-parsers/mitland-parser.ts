/**
 * Custom parser for מיטלנד - עואודה לשיווק בע"מ (MITLAND) supplier files
 *
 * File structure:
 *   - Row 1: Company title "עואודה לשיווק בע"מ"
 *   - Row 2: Report type "מכירות-קניות לפי פריטים"
 *   - Row 3: Date range
 *   - Row 4: Column headers (פריט, שם פריט, כמות, סכום נטו בשח)
 *   - Row 5+: Franchisee blocks with structure:
 *     - "שם חשבון" row with franchisee name in column B
 *     - Product rows with amounts
 *     - "סה"כ מפתח חשבון" row with totals (code in B, quantity in E, net amount in F)
 *
 * Column layout:
 *   - Column A (0): Row labels ("שם חשבון", "סה"כ מפתח חשבון", etc.)
 *   - Column B (1): Franchisee names / account codes
 *   - Column C (2): Product codes
 *   - Column D (3): Product names
 *   - Column E (4): Quantity
 *   - Column F (5): Net amount (סכום נטו בשח) - this is the commission-relevant column
 *
 * Note: Unlike TREZ_PAZOS, this file has only Net amount, no Gross column.
 * We set Gross = Net for consistency.
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundToTwoDecimals,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

// Column indices (0-based)
const LABEL_COL = 0; // Column A - row labels
const NAME_COL = 1; // Column B - franchisee name/code
const NET_AMOUNT_COL = 5; // Column F - net amount (סכום נטו בשח)

// Row labels for parsing
const ACCOUNT_NAME_LABEL = "שם חשבון";
const TOTAL_LABEL = 'סה"כ מפתח חשבון';
const REPORT_TOTAL_LABEL = 'סה"כ לדו"ח';

// Data starts after header rows (row 5, 0-indexed as 4)
const DATA_START_ROW = 4;

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
 * Get cell label (column A value)
 */
function getCellLabel(row: unknown[]): string {
  return String(row[LABEL_COL] || "").trim();
}

/**
 * Check if row is a franchisee name row
 */
function isFranchiseeNameRow(row: unknown[]): boolean {
  return getCellLabel(row) === ACCOUNT_NAME_LABEL;
}

/**
 * Check if row is a total row for a franchisee block
 */
function isTotalRow(row: unknown[]): boolean {
  return getCellLabel(row) === TOTAL_LABEL;
}

/**
 * Check if row is the report total row (end of data)
 */
function isReportTotalRow(row: unknown[]): boolean {
  return getCellLabel(row) === REPORT_TOTAL_LABEL;
}

interface FranchiseeBlock {
  franchisee: string;
  netAmount: number;
  nameRowNumber: number;
  totalRowNumber: number;
}

/**
 * Parse מיטלנד supplier file
 */
export function parseMitlandFile(buffer: Buffer): FileProcessingResult {
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

    // Use first sheet
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

    // Find franchisee blocks by matching "שם חשבון" rows with their "סה"כ מפתח חשבון" rows
    const franchiseeBlocks: FranchiseeBlock[] = [];
    let currentFranchisee: { name: string; rowNumber: number } | null = null;

    for (let rowIdx = DATA_START_ROW; rowIdx < rawData.length; rowIdx++) {
      const row = rawData[rowIdx];
      if (!row) continue;

      // Check for report total row (end of data)
      if (isReportTotalRow(row)) {
        break;
      }

      // Check for franchisee name row
      if (isFranchiseeNameRow(row)) {
        const franchiseeName = String(row[NAME_COL] || "").trim();
        if (franchiseeName) {
          currentFranchisee = {
            name: franchiseeName,
            rowNumber: rowIdx + 1, // 1-indexed for display
          };
        }
        continue;
      }

      // Check for total row (captures amounts for current franchisee)
      if (isTotalRow(row) && currentFranchisee) {
        const netAmount = parseNumericValue(row[NET_AMOUNT_COL]);

        franchiseeBlocks.push({
          franchisee: currentFranchisee.name,
          netAmount,
          nameRowNumber: currentFranchisee.rowNumber,
          totalRowNumber: rowIdx + 1,
        });

        currentFranchisee = null;
        continue;
      }
    }

    if (franchiseeBlocks.length === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Could not find any franchisee blocks in the file",
        })
      );
      legacyErrors.push("Could not find any franchisee blocks in the file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rawData.length);
    }

    // Convert franchisee blocks to ParsedRowData
    let totalNet = 0;
    let processedCount = 0;
    let skippedCount = 0;
    let rowNumber = 1;

    for (const block of franchiseeBlocks) {
      // Skip blocks with non-positive net amount
      if (block.netAmount <= 0) {
        warnings.push(
          createFileProcessingError("NEGATIVE_AMOUNT", {
            rowNumber: block.nameRowNumber,
            details: `Franchisee "${block.franchisee}" has non-positive net amount: ${block.netAmount}`,
            value: String(block.netAmount),
          })
        );
        skippedCount++;
        continue;
      }

      if (!block.franchisee) {
        warnings.push(
          createFileProcessingError("EMPTY_FRANCHISEE_NAME", {
            rowNumber: block.nameRowNumber,
          })
        );
        legacyWarnings.push(`Row ${block.nameRowNumber}: Empty franchisee name`);
        skippedCount++;
        continue;
      }

      // Set Gross = Net since file only has Net amounts
      const netAmountRounded = roundToTwoDecimals(block.netAmount);
      data.push({
        franchisee: block.franchisee,
        date: null,
        grossAmount: netAmountRounded,
        netAmount: netAmountRounded,
        originalAmount: netAmountRounded,
        rowNumber: rowNumber++,
      });

      totalNet += block.netAmount;
      processedCount++;
    }

    if (processedCount === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Could not extract any valid franchisee data from the file",
        })
      );
      legacyErrors.push("Could not extract any valid franchisee data from the file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rawData.length);
    }

    const totalNetRounded = roundToTwoDecimals(totalNet);
    return createResult(
      true,
      data,
      errors,
      warnings,
      legacyErrors,
      legacyWarnings,
      rawData.length,
      processedCount,
      skippedCount,
      totalNetRounded, // Gross = Net
      totalNetRounded
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
      vatAdjusted: false,
    },
  };
}
