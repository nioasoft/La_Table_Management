/**
 * Custom parser for יעקב סוכנויות (YAAKOV_AGENCIES) supplier files
 *
 * Problem: Hierarchical structure with forward fill needed
 * Structure:
 *   - Row 0: Title
 *   - Row 1-2: Empty
 *   - Row 3: Headers (סניף, תאריך, מס' חשבון, סכום)
 *   - Row 4: Empty
 *   - Row 5: Category header (e.g., "פט ויני")
 *   - Row 6+: Data rows with " symbol meaning "same as above"
 *
 * Solution: Forward fill - remember last customer name and apply to rows with "
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
 * Parse יעקב סוכנויות supplier file with hierarchical structure
 */
export function parseYaakovAgenciesFile(buffer: Buffer): FileProcessingResult {
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

    if (!rawData || rawData.length === 0) {
      errors.push(createFileProcessingError("FILE_EMPTY"));
      legacyErrors.push("File is empty");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    // Configuration based on file analysis:
    // Header row is at index 3
    // Data starts at row 6 (index 6)
    // Franchisee column: B (index 1)
    // Amount column: D (index 4) - "סכום"
    const DATA_START_ROW = 6;
    const FRANCHISEE_COL = 1; // Column B
    const AMOUNT_COL = 4;     // Column E (0-indexed as 4)

    // Aggregate amounts per customer
    const customerAmounts: Map<string, number> = new Map();

    let currentCustomer = "";
    let skippedRows = 0;

    for (let rowIdx = DATA_START_ROW; rowIdx < rawData.length; rowIdx++) {
      const row = rawData[rowIdx];
      if (!row || row.length === 0) {
        skippedRows++;
        continue;
      }

      // Get franchisee name - handle forward fill
      const franchiseeValue = String(row[FRANCHISEE_COL] || "").trim();

      if (franchiseeValue === '"' || franchiseeValue === '״') {
        // Same as above - use current customer
      } else if (franchiseeValue && franchiseeValue !== "") {
        currentCustomer = franchiseeValue;
      }

      // Skip if no customer determined yet
      if (!currentCustomer) {
        skippedRows++;
        continue;
      }

      // Skip category headers and summary rows
      if (
        currentCustomer.includes("סה״כ") ||
        currentCustomer.includes("סהכ") ||
        currentCustomer === "פט ויני" ||
        currentCustomer === "מינה טומיי" ||
        currentCustomer === "קינג קונג"
      ) {
        skippedRows++;
        continue;
      }

      // Check if ANY cell in the row contains "סה"כ" (total) - skip total rows
      const rowString = row.map(cell => String(cell || "")).join(" ");
      if (
        rowString.includes('סה"כ') ||
        rowString.includes("סה״כ") ||
        rowString.includes("סהכ") ||
        rowString.includes("זכוי בגובה")
      ) {
        skippedRows++;
        continue;
      }

      // Get amount from column E (index 4)
      const amountValue = row[AMOUNT_COL];
      if (amountValue !== null && amountValue !== undefined && amountValue !== "") {
        const amount = parseFloat(String(amountValue).replace(/[,₪\s]/g, ""));
        if (!isNaN(amount) && amount !== 0) {
          const existing = customerAmounts.get(currentCustomer) || 0;
          customerAmounts.set(currentCustomer, existing + amount);
        }
      }
    }

    // Convert to ParsedRowData
    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let rowNumber = 1;

    for (const [customer, amount] of customerAmounts.entries()) {
      // Skip invalid entries or summary rows
      if (amount === 0) continue;

      // Amounts in file INCLUDE VAT (gross amounts)
      // Calculate net by removing VAT
      const grossAmount = roundToTwoDecimals(amount);
      const netAmount = roundToTwoDecimals(amount / (1 + VAT_RATE));

      data.push({
        franchisee: customer,
        date: null,
        grossAmount,
        netAmount,
        originalAmount: grossAmount, // Original amount from file includes VAT
        rowNumber: rowNumber++,
      });

      totalNetAmount += netAmount;
      totalGrossAmount += grossAmount;
      processedRows++;
    }

    if (processedRows === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Could not extract any customer data from the file",
        })
      );
      legacyErrors.push("Could not extract any customer data from the file");
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
      vatAdjusted: false,
    },
  };
}
