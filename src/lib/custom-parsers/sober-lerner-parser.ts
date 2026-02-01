/**
 * Custom parser for סובר לרנר (SOBER_LERNER) supplier files
 *
 * Problem: Grouped by month/franchisee, with pre-calculated totals
 * Structure:
 *   - Row 1: Headers
 *   - Row 2+: Data rows grouped by month and franchisee
 *
 * Key columns:
 *   - Column A (0): Month (only filled on first row of month block)
 *   - Column B (1): Franchisee name ("סניף") - only filled on first row of franchisee block
 *   - Column E (4): Quantity ("כמות")
 *   - Column F (5): Price per item ("מחיר לזכיין")
 *   - Column G (6): Total amount for franchisee ("סהכ לזכיין") - PURCHASE AMOUNT
 *   - Column H (7): Commission per item ("עמלת רשת לפריט")
 *   - Column I (8): Total commission ("סהכ עמלת רשת") - PRE-CALCULATED COMMISSION
 *
 * Logic:
 *   - Track current franchisee as we iterate
 *   - Read pre-calculated totals from columns G (purchase amount) and I (commission)
 *   - Aggregate by franchisee
 *   - Note: This supplier provides pre-calculated values, no need to calculate
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
const TOTAL_AMOUNT_COL = 6; // Column G - סהכ לזכיין (purchase amount)
const TOTAL_COMMISSION_COL = 8; // Column I - סהכ עמלת רשת (pre-calculated commission)

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

    // Track current franchisee and aggregate amounts/commissions
    let currentFranchisee = "";
    const franchiseeData: Map<string, { amount: number; commission: number }> = new Map();
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

      // Read pre-calculated totals from columns G (amount) and I (commission)
      const totalAmount = parseNumericValue(row[TOTAL_AMOUNT_COL]);
      const totalCommission = parseNumericValue(row[TOTAL_COMMISSION_COL]);

      // Aggregate by franchisee
      if (totalAmount !== 0 || totalCommission !== 0) {
        const existing = franchiseeData.get(currentFranchisee) || { amount: 0, commission: 0 };
        franchiseeData.set(currentFranchisee, {
          amount: existing.amount + totalAmount,
          commission: existing.commission + totalCommission,
        });
      }
    }

    // Convert to ParsedRowData
    // Purchase amount goes to grossAmount/netAmount, commission to preCalculatedCommission
    let totalAmount = 0;
    let totalCommission = 0;
    let processedRows = 0;
    let rowNumber = 1;

    for (const [franchisee, { amount, commission }] of franchiseeData.entries()) {
      // Skip franchisees with zero or negative amounts
      if (amount <= 0) {
        if (amount < 0) {
          warnings.push(
            createFileProcessingError("NEGATIVE_AMOUNT", {
              details: `Franchisee "${franchisee}" has negative amount: ${amount}`,
              value: String(amount),
            })
          );
        }
        continue;
      }

      const roundedAmount = roundToTwoDecimals(amount);
      const roundedCommission = roundToTwoDecimals(commission);

      // Purchase amount (סהכ לזכיין) goes to grossAmount/netAmount
      // Pre-calculated commission (סהכ עמלת רשת) goes to preCalculatedCommission
      data.push({
        franchisee,
        date: null,
        grossAmount: roundedAmount,
        netAmount: roundedAmount,
        originalAmount: roundedAmount,
        rowNumber: rowNumber++,
        preCalculatedCommission: roundedCommission,
      });

      totalAmount += roundedAmount;
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
      totalAmount,
      totalAmount
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
