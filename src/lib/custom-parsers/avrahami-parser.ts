/**
 * Custom parser for אברהמי (AVRAHAMI) supplier files
 *
 * Problem: Pivot table format with many columns
 * Structure:
 *   - Row 0: Headers with customer names (repeating every 3 columns starting from col 3)
 *            Col 3: "מינה טומיי ביאליק * אודון", Col 6: "מינה טומיי יהוד * אושיבה", etc.
 *   - Row 1: Column types for each customer: כמות, סכום, סכום עמלה
 *   - Row 2+: Product data with amounts for each customer
 *
 * We need to extract the "סכום עמלה" column for each customer (3rd col in each group)
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

/**
 * Parse אברהמי supplier file with pivot table format
 */
export function parseAvrahamiFile(buffer: Buffer): FileProcessingResult {
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

    // Look for the "pivot" sheet
    let sheetName = workbook.SheetNames.find(
      (name) => name.toLowerCase().includes("pivot")
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

    if (!rawData || rawData.length < 3) {
      errors.push(createFileProcessingError("FILE_EMPTY"));
      legacyErrors.push("File is empty or too short");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    // Row 0 contains customer names - they appear every 3 columns starting from column 3
    // Row 1 contains column types: כמות, סכום, סכום עמלה (repeating)
    const headerRow = rawData[0] || [];
    const columnTypeRow = rawData[1] || [];

    // Build a map of customer name to their "סכום עמלה" column index
    const customerCommissionColumns: Map<string, number> = new Map();

    // Customer names start at column 3, every 3 columns
    for (let colIdx = 3; colIdx < headerRow.length; colIdx += 3) {
      const customerName = String(headerRow[colIdx] || "").trim();
      if (!customerName) continue;

      // Clean up the customer name (remove duplicates like "שם * שם")
      const cleanName = customerName.includes("*")
        ? customerName.split("*")[0].trim()
        : customerName;

      // The "סכום עמלה" column is the 3rd column in each customer group (offset +2)
      const commissionColIdx = colIdx + 2;

      // Verify this is the commission column
      const colType = String(columnTypeRow[commissionColIdx] || "").trim().toLowerCase();
      if (colType.includes("עמלה") || colType.includes("commission")) {
        customerCommissionColumns.set(cleanName, commissionColIdx);
      } else {
        // If not, try to find the commission column nearby
        for (let offset = 0; offset <= 2; offset++) {
          const checkColType = String(columnTypeRow[colIdx + offset] || "").trim().toLowerCase();
          if (checkColType.includes("עמלה")) {
            customerCommissionColumns.set(cleanName, colIdx + offset);
            break;
          }
        }
      }
    }

    // Sum commission amounts for each customer across all data rows
    const customerTotals: Map<string, number> = new Map();

    // Start from row 2 (skip header and column types)
    for (let rowIdx = 2; rowIdx < rawData.length; rowIdx++) {
      const row = rawData[rowIdx];
      if (!row) continue;

      // Skip summary rows
      const firstCell = String(row[0] || "").toLowerCase();
      if (firstCell.includes("סה״כ") || firstCell.includes("סהכ") || firstCell.includes("total")) {
        continue;
      }

      // Sum commission for each customer
      for (const [customer, colIdx] of customerCommissionColumns.entries()) {
        const cellValue = row[colIdx];
        if (cellValue !== null && cellValue !== undefined && cellValue !== "") {
          const amount = parseFloat(String(cellValue).replace(/[,₪\s]/g, ""));
          if (!isNaN(amount) && amount !== 0) {
            const existing = customerTotals.get(customer) || 0;
            customerTotals.set(customer, existing + amount);
          }
        }
      }
    }

    // Convert to ParsedRowData
    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let rowNumber = 1;

    for (const [customer, amount] of customerTotals.entries()) {
      // Skip invalid entries
      if (amount <= 0 || customer.includes("סה״כ") || customer.includes("סהכ")) {
        continue;
      }

      const netAmount = roundToTwoDecimals(amount);
      const grossAmount = roundToTwoDecimals(amount * (1 + VAT_RATE));

      data.push({
        franchisee: customer,
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
          details: "Could not extract any customer data from the pivot table",
        })
      );
      legacyErrors.push("Could not extract any customer data from the pivot table");
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
      rawData.length - processedRows - 2,
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
