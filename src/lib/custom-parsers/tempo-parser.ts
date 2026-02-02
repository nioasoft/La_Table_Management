/**
 * Custom parser for טמפו (TEMPO) supplier files
 *
 * File Structure: Two sheets in the Excel file
 *
 * Sheet 1: "צבירת הנחה 144169"
 *   - Column D (index 3): שם לקוח - Franchisee name
 *   - Column K (index 10): ערך מכירות נטו לחישוב - Net sales (for cross-reference)
 *   - Column L (index 11): זיכוי צבירת הנחה - Commission (negative values)
 *
 * Sheet 2: "הנחת מחזור 144169"
 *   - Column D (index 3): שם לקוח - Franchisee name
 *   - Column L (index 11): זיכוי הנחת מחזור - Additional commission (negative values)
 *
 * Processing Logic:
 *   1. Skip header row (row 0) and total rows (containing "תוצאה כוללת")
 *   2. Group by franchisee name (column D)
 *   3. netAmount: Sum of ערך מכירות נטו לחישוב from Sheet 1 only
 *   4. preCalculatedCommission: Sum of absolute values of commissions from BOTH sheets
 *
 * Note: Commission values in file are negative, need to take absolute value.
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

// Column indices
const FRANCHISEE_COL = 3; // Column D - שם לקוח
const NET_SALES_COL = 10; // Column K - ערך מכירות נטו לחישוב
const COMMISSION_COL = 11; // Column L - זיכוי צבירת הנחה / זיכוי הנחת מחזור

interface FranchiseeData {
  netAmount: number;
  commission: number;
}

/**
 * Parse טמפו supplier file with two sheets
 */
export function parseTempoFile(buffer: Buffer): FileProcessingResult {
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

    if (workbook.SheetNames.length < 2) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: `Expected 2 sheets but found ${workbook.SheetNames.length}`,
        })
      );
      legacyErrors.push(
        `Expected 2 sheets but found ${workbook.SheetNames.length}`
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

    // Find sheets by name (order in file may vary)
    const tzviratHanachaSheetName = workbook.SheetNames.find((name) =>
      name.includes("צבירת הנחה")
    );
    const hanachatMachzorSheetName = workbook.SheetNames.find((name) =>
      name.includes("הנחת מחזור")
    );

    if (!tzviratHanachaSheetName || !hanachatMachzorSheetName) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: `Could not find required sheets. Found: ${workbook.SheetNames.join(", ")}`,
        })
      );
      legacyErrors.push(
        `Could not find required sheets. Found: ${workbook.SheetNames.join(", ")}`
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

    // Map to aggregate data by franchisee
    const franchiseeData: Map<string, FranchiseeData> = new Map();
    let totalRowsProcessed = 0;

    // Process "צבירת הנחה" sheet - get BOTH netAmount (column K) and commission (column L)
    const tzviratSheet = workbook.Sheets[tzviratHanachaSheetName];
    const tzviratData: unknown[][] = XLSX.utils.sheet_to_json(tzviratSheet, {
      header: 1,
      raw: false,
      defval: "",
    });

    for (let i = 1; i < tzviratData.length; i++) {
      const row = tzviratData[i];
      if (!row) continue;

      const franchiseeName = String(row[FRANCHISEE_COL] || "").trim();

      // Skip empty names or total rows
      if (!franchiseeName || franchiseeName.includes("תוצאה כוללת")) {
        continue;
      }

      const netSalesStr = String(row[NET_SALES_COL] || "").trim();
      const commissionStr = String(row[COMMISSION_COL] || "").trim();

      const netSales = parseNumber(netSalesStr);
      const commission = parseNumber(commissionStr);

      // Get or create franchisee entry
      const existing = franchiseeData.get(franchiseeName) || {
        netAmount: 0,
        commission: 0,
      };

      // Add net sales (only from this sheet) and commission (keep sign, will take abs at end)
      existing.netAmount += netSales;
      existing.commission += commission;

      franchiseeData.set(franchiseeName, existing);
      totalRowsProcessed++;
    }

    // Process "הנחת מחזור" sheet - get ONLY commission (column L), NOT netAmount
    const machzorSheet = workbook.Sheets[hanachatMachzorSheetName];
    const machzorData: unknown[][] = XLSX.utils.sheet_to_json(machzorSheet, {
      header: 1,
      raw: false,
      defval: "",
    });

    for (let i = 1; i < machzorData.length; i++) {
      const row = machzorData[i];
      if (!row) continue;

      const franchiseeName = String(row[FRANCHISEE_COL] || "").trim();

      // Skip empty names or total rows
      if (!franchiseeName || franchiseeName.includes("תוצאה כוללת")) {
        continue;
      }

      const commissionStr = String(row[COMMISSION_COL] || "").trim();
      const commission = parseNumber(commissionStr);

      // Get or create franchisee entry
      const existing = franchiseeData.get(franchiseeName) || {
        netAmount: 0,
        commission: 0,
      };

      // Add commission only (keep sign, will take abs at end) - NOT netAmount from this sheet
      existing.commission += commission;

      franchiseeData.set(franchiseeName, existing);
      totalRowsProcessed++;
    }

    // Convert aggregated data to ParsedRowData
    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let totalPreCalculatedCommission = 0;
    let processedFranchisees = 0;
    let rowNumber = 1;

    for (const [franchisee, amounts] of franchiseeData.entries()) {
      // Skip if no meaningful data
      if (amounts.netAmount === 0 && amounts.commission === 0) {
        continue;
      }

      const netAmount = roundToTwoDecimals(amounts.netAmount);
      const grossAmount = roundToTwoDecimals(amounts.netAmount * (1 + VAT_RATE));
      // Take absolute value of commission sum (values in file are negative, some positive for refunds)
      const preCalculatedCommission = roundToTwoDecimals(Math.abs(amounts.commission));

      data.push({
        franchisee,
        date: null,
        grossAmount,
        netAmount,
        originalAmount: netAmount,
        rowNumber: rowNumber++,
        preCalculatedCommission,
      });

      totalNetAmount += netAmount;
      totalGrossAmount += grossAmount;
      totalPreCalculatedCommission += preCalculatedCommission;
      processedFranchisees++;
    }

    if (processedFranchisees === 0) {
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
        totalRowsProcessed
      );
    }

    return createResult(
      true,
      data,
      errors,
      warnings,
      legacyErrors,
      legacyWarnings,
      totalRowsProcessed,
      processedFranchisees,
      totalRowsProcessed - processedFranchisees,
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

/**
 * Parse a number string, handling Hebrew/European formatting
 */
function parseNumber(value: string): number {
  if (!value) return 0;

  // Remove currency symbols, spaces, and thousands separators
  const cleaned = value.replace(/[₪,\s]/g, "");

  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? 0 : parsed;
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
