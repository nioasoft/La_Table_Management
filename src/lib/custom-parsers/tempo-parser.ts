/**
 * Custom parser for טמפו (TEMPO) supplier files
 *
 * File Structure: Single sheet with per-item rows
 *
 *   - Column B (index 1): שם לקוח - Franchisee name
 *   - Column K (index 10): ערך מכירות נטו לצבירה - Net sales for accumulation
 *   - Column L (index 11): צבירת הנחה - Accumulated discount (commission part 1)
 *   - Cycle discount (commission part 2): Column N (14-col format) or Column O (15-col format)
 *
 * Format detection:
 *   - 14-column files (old): row 1 = totals, cycle discount in column N (index 13)
 *   - 15-column files (new): row 1 = data, new "עמלה שנתית" rate column at N,
 *     cycle discount shifted to column O (index 14)
 *
 * Processing Logic:
 *   1. Skip row 0 (headers), start from row 1
 *   2. Rows without a franchisee name (e.g. totals) are skipped automatically
 *   3. Aggregate by franchisee name (column B)
 *   4. netAmount: Sum of column K per franchisee
 *   5. preCalculatedCommission: Sum of (column L + cycle discount column) per franchisee
 *   6. grossAmount: netAmount × 1.18 (VAT)
 *
 * Note: Values are positive. Commission columns may be empty for some rows.
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundAmount,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

// VAT rate in Israel
const VAT_RATE = 0.18;

// Column indices (0-based)
const FRANCHISEE_COL = 1; // Column B - שם לקוח
const NET_SALES_COL = 10; // Column K - ערך מכירות נטו לצבירה
const ACCUM_DISCOUNT_COL = 11; // Column L - צבירת הנחה
const CYCLE_DISCOUNT_COL_OLD = 13; // Column N - הנחת מחזור (14-column format)
const CYCLE_DISCOUNT_COL_NEW = 14; // Column O - הנחת מחזור (15-column format)

// Row 0 = headers, Row 1+ = data (totals rows have no franchisee name and are skipped)
const DATA_START_ROW = 1;

interface FranchiseeData {
  netAmount: number;
  commission: number;
}

/**
 * Parse טמפו supplier file with single sheet, per-item rows
 */
export function parseTempoFile(buffer: Buffer): FileProcessingResult {
  const errors: import("../file-processing-errors").FileProcessingError[] = [];
  const warnings: import("../file-processing-errors").FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];

  try {
    const workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
    });

    if (workbook.SheetNames.length === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "No sheets found in workbook",
        })
      );
      legacyErrors.push("No sheets found in workbook");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    // Read the first sheet
    const sheet = workbook.Sheets[workbook.SheetNames[0]];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });

    // Detect format: 15+ columns = new format (cycle discount in O), else old (N)
    const headerRow = rows[0] as unknown[] | undefined;
    const colCount = headerRow ? headerRow.length : 0;
    const cycleDiscountCol = colCount >= 15 ? CYCLE_DISCOUNT_COL_NEW : CYCLE_DISCOUNT_COL_OLD;

    // Aggregate data by franchisee name
    const franchiseeData: Map<string, FranchiseeData> = new Map();
    let totalRowsProcessed = 0;

    for (let i = DATA_START_ROW; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const franchiseeName = String(row[FRANCHISEE_COL] || "").trim();
      if (!franchiseeName) continue;

      const netSales = parseNumber(String(row[NET_SALES_COL] || ""));
      const accumDiscount = parseNumber(String(row[ACCUM_DISCOUNT_COL] || ""));
      const cycleDiscount = parseNumber(String(row[cycleDiscountCol] || ""));

      const existing = franchiseeData.get(franchiseeName) || {
        netAmount: 0,
        commission: 0,
      };

      existing.netAmount += netSales;
      existing.commission += accumDiscount + cycleDiscount;

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
      if (amounts.netAmount === 0 && amounts.commission === 0) {
        continue;
      }

      const netAmount = roundAmount(amounts.netAmount);
      const grossAmount = roundAmount(amounts.netAmount * (1 + VAT_RATE));
      const preCalculatedCommission = roundAmount(amounts.commission);

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
        false, data, errors, warnings, legacyErrors, legacyWarnings, totalRowsProcessed
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
    return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
  }
}

/**
 * Parse a number string, handling Hebrew/European formatting
 */
function parseNumber(value: string): number {
  if (!value) return 0;

  const cleaned = value.replace(/[₪,\s]/g, "").trim();
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
      totalGrossAmount: roundAmount(totalGrossAmount),
      totalNetAmount: roundAmount(totalNetAmount),
      vatAdjusted: false,
    },
  };
}
