/**
 * Custom parser for וונג שו (WONG_SHU) supplier files
 *
 * Problem: Multi-sheet file with one franchisee per sheet
 * Structure:
 *   - Multiple sheets, one per franchisee
 *   - Sheet name = Franchisee name
 *   - Last row contains "סה"כ לדוח" with grand total in column D (3)
 *
 * Key columns:
 *   - Sheet name: Franchisee name
 *   - Last row, Column D (3): Grand total for the sheet
 *
 * Logic:
 *   - Iterate over all sheets
 *   - Use sheet name as franchisee name
 *   - Find last row containing "סה"כ לדוח" or similar
 *   - Extract total from column D
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

// Column index for total amount (0-based)
const TOTAL_COL = 3; // Column D

// Keywords to identify the total row
const TOTAL_ROW_KEYWORDS = ["סה״כ לדוח", "סהכ לדוח", "סה״כ", "סהכ", "total"];

// Sheets to skip (summary sheets, etc.)
const SKIP_SHEETS = ["סיכום", "summary", "total", "sheet1"];

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
 * Check if a row is a total row
 */
function isTotalRow(row: unknown[]): boolean {
  const rowText = row.map((cell) => String(cell || "").toLowerCase()).join(" ");
  return TOTAL_ROW_KEYWORDS.some((keyword) => rowText.includes(keyword.toLowerCase()));
}

/**
 * Find the maximum numeric value in a row
 */
function findMaxValueInRow(row: unknown[]): number {
  let maxVal = 0;
  for (const cell of row) {
    const val = parseNumericValue(cell);
    if (val > maxVal) {
      maxVal = val;
    }
  }
  return maxVal;
}

/**
 * Parse וונג שו supplier file with multiple sheets
 */
export function parseWongShuFile(buffer: Buffer): FileProcessingResult {
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

    if (workbook.SheetNames.length === 0) {
      errors.push(createFileProcessingError("NO_WORKSHEETS"));
      legacyErrors.push("No worksheets found in file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedSheets = 0;
    let totalRows = 0;
    let rowNumber = 1;

    // Process each sheet
    for (const sheetName of workbook.SheetNames) {
      // Skip summary sheets
      if (SKIP_SHEETS.some((skip) => sheetName.toLowerCase().includes(skip))) {
        continue;
      }

      const sheet = workbook.Sheets[sheetName];
      const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: "",
      });

      totalRows += rawData.length;

      if (!rawData || rawData.length < 2) {
        warnings.push(
          createFileProcessingError("PARSE_ERROR", {
            details: `Sheet "${sheetName}" is empty or too short`,
          })
        );
        continue;
      }

      // Find the total row (search from bottom up)
      // The total can be in different columns depending on the file structure
      let totalAmount = 0;
      let foundTotal = false;

      for (let rowIdx = rawData.length - 1; rowIdx >= Math.max(0, rawData.length - 10); rowIdx--) {
        const row = rawData[rowIdx];
        if (!row) continue;

        // Check if this is a total row by keyword
        if (isTotalRow(row)) {
          totalAmount = findMaxValueInRow(row);
          foundTotal = true;
          break;
        }

        // Try to find a row with a large value (likely the grand total)
        const maxVal = findMaxValueInRow(row);
        if (maxVal > 10000) {
          // Likely a total row
          totalAmount = maxVal;
          foundTotal = true;
          break;
        }
      }

      if (!foundTotal) {
        // Try to get total from last non-empty row
        for (let rowIdx = rawData.length - 1; rowIdx >= 0; rowIdx--) {
          const row = rawData[rowIdx];
          if (!row) continue;

          const amount = findMaxValueInRow(row);
          if (amount !== 0) {
            totalAmount = amount;
            foundTotal = true;
            break;
          }
        }
      }

      if (!foundTotal || totalAmount <= 0) {
        if (totalAmount < 0) {
          warnings.push(
            createFileProcessingError("NEGATIVE_AMOUNT", {
              details: `Sheet "${sheetName}" has negative total: ${totalAmount}`,
              value: String(totalAmount),
            })
          );
        } else {
          warnings.push(
            createFileProcessingError("PARSE_ERROR", {
              details: `Could not find valid total for sheet "${sheetName}"`,
            })
          );
        }
        continue;
      }

      // Use sheet name as franchisee name
      const franchisee = sheetName.trim();

      // Amounts appear to include VAT
      const grossAmount = roundToTwoDecimals(totalAmount);
      const netAmount = roundToTwoDecimals(totalAmount / (1 + VAT_RATE));

      data.push({
        franchisee,
        date: null,
        grossAmount,
        netAmount,
        originalAmount: grossAmount,
        rowNumber: rowNumber++,
      });

      totalGrossAmount += grossAmount;
      totalNetAmount += netAmount;
      processedSheets++;
    }

    if (processedSheets === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Could not extract any franchisee data from any sheet",
        })
      );
      legacyErrors.push("Could not extract any franchisee data from any sheet");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, totalRows);
    }

    return createResult(
      true,
      data,
      errors,
      warnings,
      legacyErrors,
      legacyWarnings,
      totalRows,
      processedSheets,
      workbook.SheetNames.length - processedSheets,
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
