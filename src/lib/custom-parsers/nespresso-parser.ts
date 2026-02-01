/**
 * Custom parser for נספרסו (NESPRESSO) supplier files
 *
 * Problem: Unique commission calculation based on capsule quantity, not amount
 * Structure:
 *   - Rows 5-6 (0-indexed: 4-5): Bilingual headers (English/Hebrew)
 *   - Rows 7-28 (0-indexed: 6-27): Franchisee data
 *   - Row 30+: Summary rows (skip)
 *
 * Key columns (0-indexed):
 *   - Column A (0): שם העסק - Franchisee name
 *   - Column B (1): קוד - Code
 *   - Column C (2): מספר קפסולות - Capsule count
 *   - Column D (3): מחזור כולל מע"מ - Gross turnover (including VAT)
 *   - Column E (4): מחזור נטו - Net turnover (excluding VAT) - FOR CROSS-REFERENCE
 *
 * Commission Logic:
 *   - Commission = Number of capsules × 0.21 NIS per capsule
 *   - Cross-reference comparison uses net turnover (Column E)
 *   - Commission is NOT calculated from the turnover amount
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundToTwoDecimals,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

// Column indices (0-based)
const FRANCHISEE_COL = 0; // Column A - שם העסק
const CAPSULES_COL = 2; // Column C - מספר קפסולות
const GROSS_AMOUNT_COL = 3; // Column D - מחזור כולל מע"מ
const NET_AMOUNT_COL = 4; // Column E - מחזור נטו

// Row configuration
const DATA_START_ROW = 6; // Row 7 (0-indexed)
const DATA_END_ROW = 27; // Row 28 (0-indexed)

// Commission rate: 0.21 NIS per capsule
const COMMISSION_PER_CAPSULE = 0.21;

// Skip keywords for summary rows
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
 * Check if a row is a summary row that should be skipped
 */
function isSummaryRow(row: unknown[]): boolean {
  const rowText = row
    .map((cell) => String(cell || "").toLowerCase())
    .join(" ");
  return SKIP_KEYWORDS.some((keyword) =>
    rowText.includes(keyword.toLowerCase())
  );
}

/**
 * Check if a row has valid data (non-empty franchisee name)
 */
function hasValidFranchiseeName(value: unknown): boolean {
  if (!value) return false;
  const str = String(value).trim();
  return str.length > 0 && !SKIP_KEYWORDS.some((kw) => str.includes(kw));
}

/**
 * Parse נספרסו (Nespresso) supplier file
 */
export function parseNespressoFile(buffer: Buffer): FileProcessingResult {
  const errors: import("../file-processing-errors").FileProcessingError[] = [];
  const warnings: import("../file-processing-errors").FileProcessingError[] =
    [];
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
      return createResult(
        false,
        data,
        errors,
        warnings,
        legacyErrors,
        legacyWarnings,
        0
      );
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
      return createResult(
        false,
        data,
        errors,
        warnings,
        legacyErrors,
        legacyWarnings,
        0
      );
    }

    let processedRows = 0;
    let skippedRows = 0;
    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let totalCommission = 0;

    // Process data rows (rows 7-28, 0-indexed 6-27)
    const maxRow = Math.min(DATA_END_ROW, rawData.length - 1);

    for (let rowIdx = DATA_START_ROW; rowIdx <= maxRow; rowIdx++) {
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

      const franchisee = String(row[FRANCHISEE_COL] || "").trim();

      // Skip rows without a valid franchisee name
      if (!hasValidFranchiseeName(franchisee)) {
        skippedRows++;
        continue;
      }

      const capsules = parseNumericValue(row[CAPSULES_COL]);
      const grossAmount = parseNumericValue(row[GROSS_AMOUNT_COL]);
      const netAmount = parseNumericValue(row[NET_AMOUNT_COL]);

      // Skip rows with 0 capsules (no activity)
      if (capsules <= 0) {
        skippedRows++;
        continue;
      }

      // Calculate commission: capsules × 0.21 NIS
      const commission = capsules * COMMISSION_PER_CAPSULE;

      const roundedGrossAmount = roundToTwoDecimals(grossAmount);
      const roundedNetAmount = roundToTwoDecimals(netAmount);
      const roundedCommission = roundToTwoDecimals(commission);

      data.push({
        franchisee,
        date: null,
        grossAmount: roundedGrossAmount,
        netAmount: roundedNetAmount, // Used for cross-reference comparison
        originalAmount: roundedNetAmount,
        rowNumber: rowIdx + 1, // Excel row number (1-based)
        preCalculatedCommission: roundedCommission, // Commission based on capsules
      });

      totalGrossAmount += roundedGrossAmount;
      totalNetAmount += roundedNetAmount;
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
      return createResult(
        false,
        data,
        errors,
        warnings,
        legacyErrors,
        legacyWarnings,
        rawData.length
      );
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
    legacyErrors.push(
      error instanceof Error ? error.message : "Unknown error"
    );
    return createResult(
      false,
      data,
      errors,
      warnings,
      legacyErrors,
      legacyWarnings,
      0
    );
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
