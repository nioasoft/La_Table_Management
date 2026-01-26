/**
 * Custom parser for פאנדנגו (FANDANGO) supplier files
 *
 * Problem: File has pre-calculated commission in column G, and multiple rows per franchisee
 * Structure:
 *   - Sheet: "AlmogERP&CRM"
 *   - Row 1: Headers
 *   - Column B: Franchisee name ("שם לקוח")
 *   - Column F: Sale amount ("סה"כ קניות (ש"ח)") - use for cross-reference
 *   - Column G: Pre-calculated commission ("עמלת רשת (ש"ח)") - use directly as commission
 *
 * The parser aggregates all rows by franchisee (including negative amounts for returns/credits)
 * and returns the pre-calculated commission to be used directly.
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundToTwoDecimals,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

// Column indices (0-based)
const FRANCHISEE_COL = 1; // Column B
const SALE_AMOUNT_COL = 5; // Column F - סה"כ קניות
const COMMISSION_COL = 6; // Column G - עמלת רשת

// Row configuration
const HEADER_ROW = 0; // Row 1 (0-indexed)
const DATA_START_ROW = 1; // Row 2 (0-indexed)

// Sheet name
const SHEET_NAME = "AlmogERP&CRM";

// Skip keywords
const SKIP_KEYWORDS = ['סה"כ', "סהכ", "total", "grand"];

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
 * Check if a row should be skipped
 */
function shouldSkipRow(row: unknown[]): boolean {
  const rowText = row.map((cell) => String(cell || "").toLowerCase()).join(" ");
  return SKIP_KEYWORDS.some((keyword) =>
    rowText.includes(keyword.toLowerCase())
  );
}

/**
 * Parse פאנדנגו supplier file with aggregation by franchisee
 */
export function parseFandangoFile(buffer: Buffer): FileProcessingResult {
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

    // Find the target sheet
    let sheetName = SHEET_NAME;
    if (!workbook.SheetNames.includes(sheetName)) {
      sheetName = workbook.SheetNames[0];
      warnings.push(
        createFileProcessingError("PARSE_ERROR", {
          details: `Configured sheet "${SHEET_NAME}" not found, using "${sheetName}"`,
        })
      );
      legacyWarnings.push(
        `Configured sheet "${SHEET_NAME}" not found, using "${sheetName}"`
      );
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

    if (!rawData || rawData.length < 2) {
      errors.push(createFileProcessingError("FILE_EMPTY"));
      legacyErrors.push("File is empty or too short");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    // Validate headers
    const headers = rawData[HEADER_ROW] || [];
    const franchiseeHeader = String(headers[FRANCHISEE_COL] || "");
    const saleHeader = String(headers[SALE_AMOUNT_COL] || "");
    const commissionHeader = String(headers[COMMISSION_COL] || "");

    // Log header validation for debugging
    if (!franchiseeHeader.includes("לקוח")) {
      warnings.push(
        createFileProcessingError("PARSE_ERROR", {
          details: `Expected franchisee column header at B, found: "${franchiseeHeader}"`,
        })
      );
    }
    if (!saleHeader.includes("קניות")) {
      warnings.push(
        createFileProcessingError("PARSE_ERROR", {
          details: `Expected sale amount header at F, found: "${saleHeader}"`,
        })
      );
    }
    if (!commissionHeader.includes("עמלה")) {
      warnings.push(
        createFileProcessingError("PARSE_ERROR", {
          details: `Expected commission header at G, found: "${commissionHeader}"`,
        })
      );
    }

    // Aggregate amounts by franchisee
    const franchiseeTotals: Map<string, { sale: number; commission: number; rowCount: number; firstRow: number }> = new Map();
    let skippedRows = 0;
    let totalRawRows = 0;

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

      totalRawRows++;

      // Extract values
      const franchisee = String(row[FRANCHISEE_COL] || "").trim();
      const saleAmount = parseNumericValue(row[SALE_AMOUNT_COL]);
      const commissionAmount = parseNumericValue(row[COMMISSION_COL]);

      // Skip rows without franchisee name
      if (!franchisee) {
        warnings.push(
          createFileProcessingError("EMPTY_FRANCHISEE_NAME", {
            rowNumber: rowIdx + 1,
          })
        );
        legacyWarnings.push(`Row ${rowIdx + 1}: Empty franchisee name`);
        skippedRows++;
        continue;
      }

      // Skip rows with zero sale amount
      if (saleAmount === 0) {
        warnings.push(
          createFileProcessingError("ZERO_AMOUNT", {
            rowNumber: rowIdx + 1,
            details: `Skipping row with zero sale amount for "${franchisee}"`,
          })
        );
        skippedRows++;
        continue;
      }

      // Get or create franchisee totals
      const existing = franchiseeTotals.get(franchisee) || {
        sale: 0,
        commission: 0,
        rowCount: 0,
        firstRow: rowIdx + 1
      };

      // Add to totals (including negative amounts for returns/credits)
      existing.sale += saleAmount;
      existing.commission += commissionAmount;
      existing.rowCount++;

      franchiseeTotals.set(franchisee, existing);
    }

    // Convert aggregated data to ParsedRowData
    let totalSaleAmount = 0;
    let totalCommission = 0;
    let processedFranchisees = 0;
    let rowNumber = 1;

    for (const [franchisee, amounts] of franchiseeTotals.entries()) {
      // Skip franchisees with zero or negative total (after aggregation)
      if (amounts.sale <= 0) {
        warnings.push(
          createFileProcessingError("NEGATIVE_AMOUNT", {
            rowNumber: amounts.firstRow,
            details: `Franchisee "${franchisee}" has non-positive total after aggregation: ${amounts.sale} (${amounts.rowCount} rows)`,
            value: String(amounts.sale),
          })
        );
        continue;
      }

      // The sale amount appears to be without VAT based on file analysis
      const netAmount = roundToTwoDecimals(amounts.sale);
      const grossAmount = roundToTwoDecimals(amounts.sale * 1.18); // Add VAT for gross
      const preCalculatedCommission = roundToTwoDecimals(amounts.commission);

      data.push({
        franchisee,
        date: null,
        grossAmount,
        netAmount,
        originalAmount: netAmount,
        rowNumber: rowNumber++,
        preCalculatedCommission,
      });

      totalSaleAmount += netAmount;
      totalCommission += preCalculatedCommission;
      processedFranchisees++;
    }

    if (processedFranchisees === 0) {
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
      processedFranchisees,
      skippedRows,
      roundToTwoDecimals(totalSaleAmount * 1.18),
      totalSaleAmount,
      totalCommission
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
