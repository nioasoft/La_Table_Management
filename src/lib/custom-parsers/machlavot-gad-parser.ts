/**
 * Custom parser for מחלבות גד (MACHLAVOT_GAD) supplier files
 *
 * Problem: Multiple pivot tables side by side in the same sheet
 * Structure:
 *   - Table 1 (Cols 0-3): Full year purchases "קניות רשת 2025"
 *   - Table 2 (Cols 4-7): Half-year with adjustments "קניות רשת כולל ניגרת חצי שנתי 7-12/2025"
 *     - Col 4: Category (קטגורית לקוח)
 *     - Col 5: Customer name
 *     - Col 6: Amount (*סכום)
 *   - Table 3 (Cols 4-7, Rows 21+): Half-year without adjustments
 *   - Other tables with product breakdowns
 *
 * We use Table 2 (columns 5-6) for the commission calculation as it includes
 * the half-year period amounts with all adjustments.
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

// Valid category values
const VALID_CATEGORIES = ["פט ויני", "מינה טומאיי", "קינג קונג"];

/**
 * Parse מחלבות גד supplier file with multiple tables
 */
export function parseMachlavotGadFile(buffer: Buffer): FileProcessingResult {
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

    const franchiseeAmounts: Map<string, number> = new Map();

    // Find the end of Table 2 (look for "Grand Total" row)
    let table2EndRow = rawData.length;
    for (let i = 2; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row) continue;
      const categoryCell = String(row[4] || "").trim();
      if (categoryCell === "Grand Total") {
        table2EndRow = i;
        break;
      }
    }

    // Extract data from Table 2 (columns 4-6), rows 2 to table2EndRow
    for (let i = 2; i < table2EndRow; i++) {
      const row = rawData[i];
      if (!row) continue;

      const categoryCell = String(row[4] || "").trim();
      const customerCell = String(row[5] || "").trim();
      const amountCell = String(row[6] || "").trim();

      // Skip if not a valid category
      if (!VALID_CATEGORIES.includes(categoryCell)) {
        continue;
      }

      // Skip if no customer name
      if (!customerCell) {
        continue;
      }

      const amount = parseFloat(amountCell.replace(/[,\s]/g, ""));
      if (!isNaN(amount) && amount !== 0) {
        const existing = franchiseeAmounts.get(customerCell) || 0;
        franchiseeAmounts.set(customerCell, existing + amount);
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
