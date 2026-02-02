/**
 * Custom parser for מדג (MADAG) supplier files
 *
 * Problem: Customer name is embedded in text cells, not in a dedicated column
 * Structure:
 *   - Row 0: Title
 *   - Row 1: Date range
 *   - Row 2: Headers (מק"ט, תאור מוצר, מטבע, הכנסה, יח', כמות, סה"כ חיוב לקוח בגין עמלות)
 *   - Row 3+: Customer header "מס. לקוח: XXXXX, שם לקוח: <name>" followed by product rows
 *
 * Two important values per customer:
 *   - Column 3 "הכנסה" (sale amount) - used for cross-reference with franchisee
 *   - Column 6 "סה"כ חיוב לקוח בגין עמלות" - only used if non-zero, otherwise commission
 *     is calculated using supplier's rate (currently files have empty column 6)
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

// Regex pattern to extract customer name from text
const CUSTOMER_NAME_REGEX = /שם לקוח[:\s]*([^\n,]+)/;

/**
 * Parse מדג supplier file with embedded customer names
 */
export function parseMadagFile(buffer: Buffer): FileProcessingResult {
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

    // Track current customer and accumulate amounts
    let currentCustomer = "";
    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let totalPreCalculatedCommission = 0;
    let processedRows = 0;
    let skippedRows = 0;

    // Aggregated amounts per customer: { sale: number, commission: number }
    const customerAmounts: Map<string, { sale: number; commission: number }> = new Map();

    // Start from row 3 (after headers)
    for (let i = 3; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) {
        skippedRows++;
        continue;
      }

      const firstCell = String(row[0] || "").trim();

      // Check if this is a customer header row
      const customerMatch = firstCell.match(CUSTOMER_NAME_REGEX);
      if (customerMatch) {
        currentCustomer = customerMatch[1].trim();
        skippedRows++;
        continue;
      }

      // Skip customer total rows (סה"כ למס. לקוח) to avoid double-counting
      const rowStr = row.map((c) => String(c || "")).join(" ");
      if (
        rowStr.includes('סה"כ') ||
        rowStr.includes("סה״כ") ||
        rowStr.includes("סהכ")
      ) {
        skippedRows++;
        continue;
      }

      // Skip rows without a current customer
      if (!currentCustomer) {
        skippedRows++;
        continue;
      }

      const existing = customerAmounts.get(currentCustomer) || { sale: 0, commission: 0 };

      // Column 3 (index 3) "הכנסה" - sale amount for cross-reference
      const saleValue = row[3];
      if (saleValue !== null && saleValue !== undefined && saleValue !== "") {
        const sale = parseFloat(String(saleValue).replace(/[,₪\s]/g, ""));
        if (!isNaN(sale)) {
          existing.sale += sale;
        }
      }

      // Column 6 (index 6) "סה"כ חיוב לקוח בגין עמלות" - pre-calculated commission
      const commissionValue = row[6];
      if (commissionValue !== null && commissionValue !== undefined && commissionValue !== "") {
        const commission = parseFloat(String(commissionValue).replace(/[,₪\s]/g, ""));
        if (!isNaN(commission)) {
          existing.commission += commission;
        }
      }

      customerAmounts.set(currentCustomer, existing);
    }

    // Convert aggregated data to ParsedRowData
    let rowNumber = 1;
    for (const [customer, amounts] of customerAmounts.entries()) {
      // Skip if sale amount is zero or negative
      if (amounts.sale <= 0) {
        skippedRows++;
        continue;
      }

      // Skip summary rows
      if (customer.includes("סה״כ") || customer.includes("סהכ") || customer.includes("סיכום")) {
        skippedRows++;
        continue;
      }

      // Sale amount is used for cross-reference (what franchisee reports)
      const netAmount = roundToTwoDecimals(amounts.sale);
      const grossAmount = roundToTwoDecimals(amounts.sale * (1 + VAT_RATE));
      // Only set preCalculatedCommission if it's a positive value
      // If 0 or empty, leave undefined so calculation falls back to supplier rate
      const preCalculatedCommission = amounts.commission > 0
        ? roundToTwoDecimals(amounts.commission)
        : undefined;

      data.push({
        franchisee: customer,
        date: null,
        grossAmount,
        netAmount,
        originalAmount: netAmount,
        rowNumber: rowNumber++,
        preCalculatedCommission,
      });

      totalNetAmount += netAmount;
      totalGrossAmount += grossAmount;
      totalPreCalculatedCommission += preCalculatedCommission ?? 0;
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
