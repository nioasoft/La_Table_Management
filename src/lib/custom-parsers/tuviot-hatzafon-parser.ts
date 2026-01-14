/**
 * Custom parser for תויות הצפון (TUVIOT_HATZAFON) supplier files
 *
 * Problem: Monthly breakdown with quarterly totals, franchisee sections
 * Structure:
 *   - Row 0-2: Headers with date columns for Oct, Nov, Dec
 *   - Row 3+: Franchisee sections:
 *     - Franchisee header row (column B has franchisee name starting with brand)
 *     - Product rows (column B has product names)
 *     - Total row (column B empty, column T/20 has quarterly total)
 *   - Last rows: Grand total row (column T has "סה"כ כללי")
 *
 * Franchisee names start with: מינה טומאיי, קינג קונג, פט ויני
 * Quarterly total column: 20 (סה"כ לרבעון)
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

// Brand prefixes that indicate a franchisee header row
const FRANCHISEE_INDICATORS = ["מינה טומאיי", "קינג קונג", "פט ויני"];

// Column index for quarterly total
const TOTAL_COL = 20;

/**
 * Parse תויות הצפון supplier file with franchisee sections and quarterly totals
 */
export function parseTuviotHatzafonFile(buffer: Buffer): FileProcessingResult {
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

    // Find the data sheet (usually first sheet or one with date pattern like "10-11-12-2025")
    let sheetName = workbook.SheetNames.find((name) =>
      /\d{1,2}-\d{1,2}-\d{1,2}-\d{4}/.test(name)
    );
    if (!sheetName) {
      sheetName = workbook.SheetNames[0];
    }

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

    if (!rawData || rawData.length < 4) {
      errors.push(createFileProcessingError("FILE_EMPTY"));
      legacyErrors.push("File is empty or too short");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    const franchiseeAmounts: Map<string, number> = new Map();
    let currentFranchisee = "";

    // Start from row 3 (after headers)
    for (let i = 3; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row) continue;

      const nameCell = String(row[1] || "").trim();
      const totalCell = String(row[TOTAL_COL] || "").trim();

      // Skip grand total row
      if (totalCell === 'סה"כ כללי' || totalCell.includes("סה״כ כללי")) {
        break;
      }

      // Check if this is a franchisee header row
      const isFranchiseeHeader = FRANCHISEE_INDICATORS.some((ind) =>
        nameCell.startsWith(ind)
      );

      if (isFranchiseeHeader) {
        currentFranchisee = nameCell;
        continue;
      }

      // Check if this is a summary row (name is empty, has total value)
      if (currentFranchisee && !nameCell && totalCell) {
        const amount = parseFloat(totalCell.replace(/[,\s]/g, ""));
        if (!isNaN(amount) && amount !== 0) {
          const existing = franchiseeAmounts.get(currentFranchisee) || 0;
          franchiseeAmounts.set(currentFranchisee, existing + amount);
        }
        // Reset after getting total
        currentFranchisee = "";
      }
    }

    // Convert to ParsedRowData
    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let rowNumber = 1;

    for (const [franchisee, amount] of franchiseeAmounts.entries()) {
      if (amount <= 0) continue;

      const netAmount = roundToTwoDecimals(amount);
      const grossAmount = roundToTwoDecimals(amount * (1 + VAT_RATE));

      data.push({
        franchisee,
        date: null,
        grossAmount,
        netAmount,
        originalAmount: netAmount,
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
      rawData.length - processedRows,
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
      vatAdjusted: false,
    },
  };
}
