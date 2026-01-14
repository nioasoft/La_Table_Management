/**
 * Custom parser for אראל אריזות (AREL_ARIZOT) supplier files
 *
 * Problem: Parameter/filter headers followed by data with alternating rows
 * Structure:
 *   - Rows 0-11: Filter/parameter headers
 *   - Row 12: Column headers:
 *     - Col 0: סכום כולל מע"מ (gross amount)
 *     - Col 3: סכום לא כולל מע"מ (net amount)
 *     - Col 8: שם לקוח (customer name)
 *     - Col 11: כרטיס לקוח (customer ID)
 *   - Rows 14, 16, 18, ...: Data rows (every other row has data)
 *   - Row with "סה"כ מכירות" in col 4: Total row
 *
 * Note: Data appears in every other row (empty rows between data rows)
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

// Column indices
const GROSS_AMOUNT_COL = 0;
const NET_AMOUNT_COL = 3;
const CUSTOMER_NAME_COL = 8;

/**
 * Parse אראל אריזות supplier file with alternating row data
 */
export function parseArelArizotFile(buffer: Buffer): FileProcessingResult {
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

    // Find the data sheet (usually "ריכוז מכירות ללקוחות" or first sheet)
    let sheetName = workbook.SheetNames.find((name) =>
      name.includes("ריכוז מכירות")
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

    if (!rawData || rawData.length < 14) {
      errors.push(createFileProcessingError("FILE_EMPTY"));
      legacyErrors.push("File is empty or too short");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    const franchiseeAmounts: Map<string, { net: number; gross: number }> = new Map();

    // Start from row 14 (first data row after headers)
    for (let i = 14; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row) continue;

      // Check for total row
      const col4 = String(row[4] || "").trim();
      if (col4.includes('סה"כ') || col4.includes("סהכ")) {
        break;
      }

      const grossAmountCell = String(row[GROSS_AMOUNT_COL] || "").trim();
      const netAmountCell = String(row[NET_AMOUNT_COL] || "").trim();
      const customerCell = String(row[CUSTOMER_NAME_COL] || "").trim();

      // Skip empty rows
      if (!customerCell && !grossAmountCell) {
        continue;
      }

      // Parse amounts
      const grossAmount = parseFloat(grossAmountCell.replace(/[,\s]/g, ""));
      const netAmount = parseFloat(netAmountCell.replace(/[,\s]/g, ""));

      if (customerCell && !isNaN(netAmount) && netAmount !== 0) {
        const existing = franchiseeAmounts.get(customerCell) || { net: 0, gross: 0 };
        franchiseeAmounts.set(customerCell, {
          net: existing.net + netAmount,
          gross: existing.gross + (isNaN(grossAmount) ? netAmount * (1 + VAT_RATE) : grossAmount),
        });
      }
    }

    // Convert to ParsedRowData
    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let rowNumber = 1;

    for (const [franchisee, amounts] of franchiseeAmounts.entries()) {
      if (amounts.net <= 0) continue;

      const netAmount = roundToTwoDecimals(amounts.net);
      const grossAmount = roundToTwoDecimals(amounts.gross);

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
