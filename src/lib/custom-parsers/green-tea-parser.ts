/**
 * Custom parser for גרינטי (GREEN_TEA) supplier files
 *
 * Problem: Invoice list with multiple rows per franchisee
 * Structure:
 *   - Row 1: Headers - includes "לקוח" (col 5/F), "סכום חייב מע"מ" (col 8/I)
 *   - Row 2+: Invoice rows (type 305=invoice, 330=credit note)
 *
 * Key columns:
 *   - Column F (5): Customer name ("לקוח")
 *   - Column I (8): Net amount before VAT ("סכום חייב מע"מ")
 *
 * Logic: Aggregate by customer name, sum net amounts
 * Credit notes (negative amounts) are handled automatically
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
const CUSTOMER_COL = 5; // Column F - לקוח
const NET_AMOUNT_COL = 8; // Column I - סכום חייב מע"מ

// Row configuration
const HEADER_ROW = 0; // Row 1 (0-indexed)
const DATA_START_ROW = 1; // Row 2 (0-indexed)

// Skip keywords - rows with these values should be skipped
const SKIP_KEYWORDS = ["סה״כ", "סהכ", "סיכום", "total", "grand total"];

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
 * Check if a row should be skipped (summary rows, etc.)
 */
function shouldSkipRow(row: unknown[]): boolean {
  const rowText = row.map((cell) => String(cell || "").toLowerCase()).join(" ");
  return SKIP_KEYWORDS.some((keyword) => rowText.includes(keyword.toLowerCase()));
}

/**
 * Parse גרינטי supplier file with invoice aggregation
 */
export function parseGreenTeaFile(buffer: Buffer): FileProcessingResult {
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

    if (!rawData || rawData.length < DATA_START_ROW + 1) {
      errors.push(createFileProcessingError("FILE_EMPTY"));
      legacyErrors.push("File is empty or too short");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    // Validate headers
    const headers = rawData[HEADER_ROW] || [];
    const customerHeader = String(headers[CUSTOMER_COL] || "").trim();
    const amountHeader = String(headers[NET_AMOUNT_COL] || "").trim();

    if (!customerHeader.includes("לקוח")) {
      warnings.push(
        createFileProcessingError("PARSE_ERROR", {
          details: `Expected customer header at column F, found: "${customerHeader}"`,
        })
      );
    }

    if (!amountHeader.includes("סכום") && !amountHeader.includes("חייב")) {
      warnings.push(
        createFileProcessingError("PARSE_ERROR", {
          details: `Expected amount header at column I, found: "${amountHeader}"`,
        })
      );
    }

    // Aggregate amounts by customer
    const customerAmounts: Map<string, number> = new Map();
    let skippedRows = 0;

    for (let rowIdx = DATA_START_ROW; rowIdx < rawData.length; rowIdx++) {
      const row = rawData[rowIdx];
      if (!row || row.length === 0) {
        skippedRows++;
        continue;
      }

      // Skip summary rows
      if (shouldSkipRow(row)) {
        skippedRows++;
        continue;
      }

      const customer = String(row[CUSTOMER_COL] || "").trim();
      if (!customer) {
        skippedRows++;
        continue;
      }

      const netAmount = parseNumericValue(row[NET_AMOUNT_COL]);

      // Include all values (positive invoices and negative credit notes)
      const existing = customerAmounts.get(customer) || 0;
      customerAmounts.set(customer, existing + netAmount);
    }

    // Convert to ParsedRowData
    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let rowNumber = 1;

    for (const [customer, netAmount] of customerAmounts.entries()) {
      // Skip customers with zero or negative total
      if (netAmount <= 0) {
        if (netAmount < 0) {
          warnings.push(
            createFileProcessingError("NEGATIVE_AMOUNT", {
              details: `Customer "${customer}" has negative total: ${netAmount}`,
              value: String(netAmount),
            })
          );
        }
        continue;
      }

      // Net amount is before VAT
      const roundedNet = roundToTwoDecimals(netAmount);
      const grossAmount = roundToTwoDecimals(netAmount * (1 + VAT_RATE));

      data.push({
        franchisee: customer,
        date: null,
        grossAmount,
        netAmount: roundedNet,
        originalAmount: roundedNet,
        rowNumber: rowNumber++,
      });

      totalNetAmount += roundedNet;
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
