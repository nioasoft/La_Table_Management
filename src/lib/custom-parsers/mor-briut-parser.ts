/**
 * Custom parser for מור בריאות (MOR_BRIUT) supplier files
 *
 * Problem: Multiple sheets ("מינה", "קינג קונג") with detailed line items
 * Structure:
 *   - Row 0-1: Header info
 *   - Row 2: Column headers (מפתח חשבון, שם חשבון, אסמכתא, תאריך, שם פריט, מחיר נטו, כמות יציאה)
 *   - Row 3: Customer summary row (name in col 0)
 *   - Row 4+: Transaction rows with:
 *       - Customer name in col 4 (שם חשבון)
 *       - Price in col 8 (מחיר נטו)
 *       - Quantity in col 9 (כמות יציאה)
 *
 * Total = מחיר נטו × כמות יציאה (sum per customer)
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
 * Parse מור בריאות supplier file with multiple sheets
 */
export function parseMorBriutFile(buffer: Buffer): FileProcessingResult {
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

    // Configuration based on file analysis:
    // Header row: 2 (index 2)
    // Data starts: row 4 (index 4) - after customer summary row
    // Customer column: 4 (index 4) - "שם חשבון"
    // Price column: 8 (index 8) - "מחיר נטו"
    // Quantity column: 9 (index 9) - "כמות יציאה"
    const DATA_START_ROW = 4;
    const CUSTOMER_COL = 4;
    const PRICE_COL = 8;
    const QUANTITY_COL = 9;

    // Aggregate amounts per customer across all sheets
    const customerAmounts: Map<string, number> = new Map();
    let totalRowsProcessed = 0;

    // Process each sheet
    for (const sheetName of workbook.SheetNames) {
      const sheet = workbook.Sheets[sheetName];
      const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: "",
      });

      if (!rawData || rawData.length <= DATA_START_ROW) {
        continue;
      }

      // Process data rows
      for (let rowIdx = DATA_START_ROW; rowIdx < rawData.length; rowIdx++) {
        const row = rawData[rowIdx];
        if (!row || row.length === 0) continue;

        // Get customer name
        const customerName = String(row[CUSTOMER_COL] || "").trim();
        if (!customerName) continue;

        // Skip summary rows
        if (
          customerName.includes("סה״כ") ||
          customerName.includes("סהכ") ||
          customerName.includes("total")
        ) {
          continue;
        }

        // Get price and quantity
        const priceValue = row[PRICE_COL];
        const quantityValue = row[QUANTITY_COL];

        if (priceValue !== null && priceValue !== undefined && priceValue !== "" &&
            quantityValue !== null && quantityValue !== undefined && quantityValue !== "") {
          const price = parseFloat(String(priceValue).replace(/[,₪\s]/g, ""));
          const quantity = parseFloat(String(quantityValue).replace(/[,\s]/g, ""));

          if (!isNaN(price) && !isNaN(quantity) && price !== 0 && quantity !== 0) {
            const lineTotal = price * quantity;
            const existing = customerAmounts.get(customerName) || 0;
            customerAmounts.set(customerName, existing + lineTotal);
            totalRowsProcessed++;
          }
        }
      }
    }

    // Convert to ParsedRowData
    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let rowNumber = 1;

    for (const [customer, amount] of customerAmounts.entries()) {
      if (amount <= 0) continue;

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
          details: "Could not extract any customer data from any sheet",
        })
      );
      legacyErrors.push("Could not extract any customer data from any sheet");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, totalRowsProcessed);
    }

    return createResult(
      true,
      data,
      errors,
      warnings,
      legacyErrors,
      legacyWarnings,
      totalRowsProcessed,
      processedRows,
      totalRowsProcessed - processedRows,
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
