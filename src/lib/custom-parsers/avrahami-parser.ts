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
 * Two important values per customer:
 *   - "סכום" (sale amount) - used for cross-reference with franchisee
 *   - "סכום עמלה" (commission amount) - pre-calculated commission (different rates per product)
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

interface CustomerColumns {
  saleColIdx: number;       // סכום - sale amount column
  commissionColIdx: number; // סכום עמלה - commission amount column
}

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
    let sheetName: string | undefined = workbook.SheetNames.find(
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

    // Build a map of customer name to their column indices
    // Each customer has 3 columns: כמות (quantity), סכום (sale amount), סכום עמלה (commission)
    const customerColumns: Map<string, CustomerColumns> = new Map();

    // Customer names start at column 3, every 3 columns
    for (let colIdx = 3; colIdx < headerRow.length; colIdx += 3) {
      const customerName = String(headerRow[colIdx] || "").trim();
      if (!customerName || customerName === "כמות") continue;

      // Clean up the customer name (remove duplicates like "שם * שם")
      const cleanName = customerName.includes("*")
        ? customerName.split("*")[0].trim()
        : customerName;

      // Column layout: colIdx=כמות, colIdx+1=סכום, colIdx+2=סכום עמלה
      // But verify by checking column type row
      let saleColIdx = colIdx + 1;
      let commissionColIdx = colIdx + 2;

      // Verify columns by checking types
      for (let offset = 0; offset <= 2; offset++) {
        const colType = String(columnTypeRow[colIdx + offset] || "").trim().toLowerCase();
        if (colType === "סכום" || colType.includes("סכום") && !colType.includes("עמלה")) {
          saleColIdx = colIdx + offset;
        }
        if (colType.includes("עמלה")) {
          commissionColIdx = colIdx + offset;
        }
      }

      customerColumns.set(cleanName, { saleColIdx, commissionColIdx });
    }

    // Find the Grand Total row and extract values directly from it
    // This is safer than summing all rows (avoids double-counting from extra summary rows)
    const customerTotals: Map<string, { sale: number; commission: number }> = new Map();
    let grandTotalRowIdx = -1;

    // Search for Grand Total row
    for (let rowIdx = 2; rowIdx < rawData.length; rowIdx++) {
      const row = rawData[rowIdx];
      if (!row) continue;

      const firstCell = String(row[0] || "").toLowerCase();
      if (firstCell.includes("grand total") || firstCell === "grand total") {
        grandTotalRowIdx = rowIdx;
        break;
      }
    }

    if (grandTotalRowIdx === -1) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Could not find Grand Total row in the pivot table",
        })
      );
      legacyErrors.push("Could not find Grand Total row in the pivot table");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rawData.length);
    }

    const grandTotalRow = rawData[grandTotalRowIdx];

    // Extract values for each customer from the Grand Total row
    for (const [customer, cols] of customerColumns.entries()) {
      const saleValue = grandTotalRow[cols.saleColIdx];
      const commissionValue = grandTotalRow[cols.commissionColIdx];

      let sale = 0;
      let commission = 0;

      if (saleValue !== null && saleValue !== undefined && saleValue !== "") {
        const parsed = parseFloat(String(saleValue).replace(/[,₪\s]/g, ""));
        if (!isNaN(parsed)) {
          sale = parsed;
        }
      }

      if (commissionValue !== null && commissionValue !== undefined && commissionValue !== "") {
        const parsed = parseFloat(String(commissionValue).replace(/[,₪\s]/g, ""));
        if (!isNaN(parsed)) {
          commission = parsed;
        }
      }

      customerTotals.set(customer, { sale, commission });
    }

    // Convert to ParsedRowData
    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let totalPreCalculatedCommission = 0;
    let processedRows = 0;
    let rowNumber = 1;

    for (const [customer, amounts] of customerTotals.entries()) {
      // Skip invalid entries
      if (amounts.sale <= 0 || customer.includes("סה״כ") || customer.includes("סהכ")) {
        continue;
      }

      // Sale amount is the amount for cross-reference (what franchisee paid)
      // This amount appears to be net (without VAT) based on file structure
      const netAmount = roundToTwoDecimals(amounts.sale);
      const grossAmount = roundToTwoDecimals(amounts.sale * (1 + VAT_RATE));
      const preCalculatedCommission = roundToTwoDecimals(amounts.commission);

      data.push({
        franchisee: customer,
        date: null,
        grossAmount,
        netAmount,
        originalAmount: netAmount,
        rowNumber: rowNumber++,
        preCalculatedCommission, // Commission already calculated by supplier
      });

      totalNetAmount += netAmount;
      totalGrossAmount += grossAmount;
      totalPreCalculatedCommission += preCalculatedCommission;
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
      totalNetAmount,
      totalPreCalculatedCommission
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
  totalNetAmount = 0,
  _totalPreCalculatedCommission = 0
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
