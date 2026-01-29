/**
 * Custom parser for סופר נובה (SUPER_NOVA) supplier files
 *
 * Problem: Multi-section file with different brands in one sheet
 * Structure:
 *   - Two sections in one sheet:
 *     - Section 1: "מינה טומי" (rows 3-10)
 *     - Section 2: "קינג קונג" (rows 17-21)
 *   - Each section has:
 *     - Title row (brand name in column E or F)
 *     - Header row ("שם סניף" in column D)
 *     - Data rows
 *     - Total row ("סה"כ" or "סהכ" in column D)
 *
 * Key columns:
 *   - Column D (3): Franchisee name ("שם סניף")
 *   - Column H (7): Total amount ("סה"כ")
 *
 * Logic:
 *   - Find header rows by looking for "שם סניף" in column D
 *   - Parse data rows until we hit a total row ("סה"כ" or "סהכ")
 *   - Extract franchisee from col D, total from col H
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
const FRANCHISEE_COL = 1; // Column B - שם סניף
const AMOUNT_COL = 5; // Column F - סה"כ

// Total row indicators (in column B)
// Include both Hebrew gershayim (״) and regular double quote (")
const TOTAL_KEYWORDS = ["סה״כ", 'סה"כ', "סהכ", "סיכום", "total"];

// Header row indicator (in column D)
const HEADER_INDICATOR = "שם סניף";

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
 * Check if a cell contains a total indicator
 */
function isTotalCell(value: unknown): boolean {
  const cellText = String(value || "").trim();
  // Check exact match or if it starts with total keyword
  return TOTAL_KEYWORDS.some((keyword) => {
    const lowerCell = cellText.toLowerCase();
    const lowerKeyword = keyword.toLowerCase();
    return lowerCell === lowerKeyword || lowerCell.startsWith(lowerKeyword);
  });
}

/**
 * Check if a cell is the header indicator
 */
function isHeaderCell(value: unknown): boolean {
  const cellText = String(value || "").trim();
  return cellText.includes(HEADER_INDICATOR);
}

/**
 * Parse סופר נובה supplier file with multiple sections
 */
export function parseSuperNovaFile(buffer: Buffer): FileProcessingResult {
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

    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let skippedRows = 0;
    let rowNumber = 1;

    // Track state
    let inDataSection = false;

    for (let rowIdx = 0; rowIdx < rawData.length; rowIdx++) {
      const row = rawData[rowIdx];
      if (!row || row.length === 0) {
        skippedRows++;
        continue;
      }

      const franchiseeCell = row[FRANCHISEE_COL];
      const franchiseeName = String(franchiseeCell || "").trim();

      // Check if this is a header row ("שם סניף")
      if (isHeaderCell(franchiseeCell)) {
        inDataSection = true;
        skippedRows++;
        continue;
      }

      // Check if this is a total row
      if (isTotalCell(franchiseeCell)) {
        inDataSection = false;
        skippedRows++;
        continue;
      }

      // If we're in a data section and have a valid franchisee name
      if (inDataSection && franchiseeName) {
        const amount = parseNumericValue(row[AMOUNT_COL]);

        if (amount <= 0) {
          if (amount < 0) {
            warnings.push(
              createFileProcessingError("NEGATIVE_AMOUNT", {
                rowNumber: rowIdx + 1,
                details: `Negative amount ${amount} for "${franchiseeName}"`,
                value: String(amount),
              })
            );
          }
          skippedRows++;
          continue;
        }

        // Amounts appear to include VAT
        const grossAmount = roundToTwoDecimals(amount);
        const netAmount = roundToTwoDecimals(amount / (1 + VAT_RATE));

        data.push({
          franchisee: franchiseeName,
          date: null,
          grossAmount,
          netAmount,
          originalAmount: grossAmount,
          rowNumber: rowNumber++,
        });

        totalGrossAmount += grossAmount;
        totalNetAmount += netAmount;
        processedRows++;
      } else {
        skippedRows++;
      }
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
