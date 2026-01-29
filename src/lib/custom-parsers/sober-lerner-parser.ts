/**
 * Custom parser for סובר לרנר (SOBER_LERNER) supplier files
 *
 * Problem: Grouped by month/franchisee, per-item commission calculation
 * Structure:
 *   - Row 1: Headers - includes "סניף" (col 1/B), "כמות" (col 4/E), "עמלת רשת לפריט" (col 7/H)
 *   - Row 2+: Data rows grouped by month and franchisee
 *
 * Key columns:
 *   - Column A (0): Month (only filled on first row of month block)
 *   - Column B (1): Franchisee name ("סניף") - only filled on first row of franchisee block
 *   - Column E (4): Quantity ("כמות")
 *   - Column H (7): Commission per item ("עמלת רשת לפריט")
 *
 * Logic:
 *   - Track current month and franchisee as we iterate
 *   - For each product row: calculate quantity * commission_per_item
 *   - Aggregate commission by franchisee
 *   - Note: This supplier has per-item commission, not percentage-based
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundToTwoDecimals,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

// Column indices (0-based)
const MONTH_COL = 0; // Column A - חודש
const FRANCHISEE_COL = 1; // Column B - סניף
const QUANTITY_COL = 4; // Column E - כמות
const COMMISSION_PER_ITEM_COL = 7; // Column H - עמלת רשת לפריט

// Row configuration
const HEADER_ROW = 0; // Row 1 (0-indexed)
const DATA_START_ROW = 1; // Row 2 (0-indexed)

// Skip keywords
const SKIP_KEYWORDS = ["סה״כ", "סהכ", "סיכום", "total", "סניף"];

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
 * Check if a row is a summary row
 */
function isSummaryRow(row: unknown[]): boolean {
  const rowText = row.map((cell) => String(cell || "").toLowerCase()).join(" ");
  return SKIP_KEYWORDS.some((keyword) => rowText.includes(keyword.toLowerCase()));
}

/**
 * Parse סובר לרנר supplier file
 */
export function parseSoberLernerFile(buffer: Buffer): FileProcessingResult {
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
    const franchiseeHeader = String(headers[FRANCHISEE_COL] || "").trim();

    if (!franchiseeHeader.includes("סניף")) {
      warnings.push(
        createFileProcessingError("PARSE_ERROR", {
          details: `Expected franchisee header at column B, found: "${franchiseeHeader}"`,
        })
      );
    }

    // Track current franchisee and aggregate commissions
    let currentFranchisee = "";
    const franchiseeCommissions: Map<string, number> = new Map();
    let skippedRows = 0;

    for (let rowIdx = DATA_START_ROW; rowIdx < rawData.length; rowIdx++) {
      const row = rawData[rowIdx];
      if (!row || row.length === 0) {
        skippedRows++;
        continue;
      }

      // Skip summary rows
      if (isSummaryRow(row)) {
        skippedRows++;
        continue;
      }

      // Check if franchisee column has a new value
      const franchiseeCell = String(row[FRANCHISEE_COL] || "").trim();
      if (franchiseeCell && franchiseeCell !== currentFranchisee) {
        currentFranchisee = franchiseeCell;
      }

      if (!currentFranchisee) {
        skippedRows++;
        continue;
      }

      // Get quantity and commission per item
      const quantity = parseNumericValue(row[QUANTITY_COL]);
      const commissionPerItem = parseNumericValue(row[COMMISSION_PER_ITEM_COL]);

      // Calculate commission for this row: quantity * commission_per_item
      const rowCommission = quantity * commissionPerItem;

      if (rowCommission !== 0) {
        const existing = franchiseeCommissions.get(currentFranchisee) || 0;
        franchiseeCommissions.set(currentFranchisee, existing + rowCommission);
      }
    }

    // Convert to ParsedRowData
    // Note: For per-item commission suppliers, we use the commission as both
    // the amount and store it in preCalculatedCommission
    let totalCommission = 0;
    let processedRows = 0;
    let rowNumber = 1;

    for (const [franchisee, commission] of franchiseeCommissions.entries()) {
      // Skip franchisees with zero or negative commission
      if (commission <= 0) {
        if (commission < 0) {
          warnings.push(
            createFileProcessingError("NEGATIVE_AMOUNT", {
              details: `Franchisee "${franchisee}" has negative commission: ${commission}`,
              value: String(commission),
            })
          );
        }
        continue;
      }

      const roundedCommission = roundToTwoDecimals(commission);

      // For per-item commission suppliers, the commission is pre-calculated
      // We don't have a purchase amount for cross-reference, so we use commission as the amount
      data.push({
        franchisee,
        date: null,
        grossAmount: roundedCommission,
        netAmount: roundedCommission,
        originalAmount: roundedCommission,
        rowNumber: rowNumber++,
        preCalculatedCommission: roundedCommission,
      });

      totalCommission += roundedCommission;
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
      skippedRows,
      totalCommission,
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
