/**
 * Custom parser for מחלבות גד (MACHLAVOT_GAD) supplier files
 *
 * Problem: Multiple pivot tables side by side in the same sheet
 * Structure:
 *   - Table 1 (Cols 0-3): Full year purchases "קניות רשת 2025"
 *   - Table 2 (Cols 4-7): Half-year with adjustments "קניות רשת כולל ניגרת חצי שנתי 7-12/2025"
 *     - Col 4: Category (קטגורית לקוח)
 *     - Col 5: Customer name
 *     - Col 6: Amount (*סכום)
 *   - Table 3 (Cols 4-7, starting after Table 2): Half-year without adjustments "לא כולל ניגרת"
 *
 * Important distinction:
 *   - Table 2 ("כולל ניגרת"): Used for cross-reference comparison with franchisee reports
 *   - Table 3 ("לא כולל ניגרת"): Used as basis for 9% commission calculation
 *
 * We need BOTH tables:
 *   - netAmount from Table 2 (for cross-reference)
 *   - preCalculatedCommission from Table 3 × 9% (for commission)
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

// Commission rate for מחלבות גד
const COMMISSION_RATE = 0.09;

// Valid category values
const VALID_CATEGORIES = ["פט ויני", "מינה טומאיי", "קינג קונג"];

/**
 * Parse מחלבות גד supplier file with multiple tables
 */
export function parseMachlavotGadFile(buffer: Buffer): FileProcessingResult {
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

    if (!rawData || rawData.length < 3) {
      errors.push(createFileProcessingError("FILE_EMPTY"));
      legacyErrors.push("File is empty or too short");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    // Maps to store amounts by franchisee name
    const table2Amounts: Map<string, number> = new Map(); // "כולל ניגרת" - for cross-reference
    const table3Amounts: Map<string, number> = new Map(); // "לא כולל ניגרת" - for commission

    // Find the end of Table 2 (look for "Grand Total" row)
    let table2EndRow = rawData.length;
    for (let i = 2; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row) continue;
      const categoryCell = String(row[4] || "").trim();
      if (categoryCell === "Grand Total") {
        table2EndRow = i;
        break;
      }
    }

    // Extract data from Table 2 (columns 4-6), rows 2 to table2EndRow
    for (let i = 2; i < table2EndRow; i++) {
      const row = rawData[i];
      if (!row) continue;

      const categoryCell = String(row[4] || "").trim();
      const customerCell = String(row[5] || "").trim();
      const amountCell = String(row[6] || "").trim();

      // Skip if not a valid category
      if (!VALID_CATEGORIES.includes(categoryCell)) {
        continue;
      }

      // Skip if no customer name
      if (!customerCell) {
        continue;
      }

      const amount = parseFloat(amountCell.replace(/[,\s]/g, ""));
      if (!isNaN(amount) && amount !== 0) {
        const existing = table2Amounts.get(customerCell) || 0;
        table2Amounts.set(customerCell, existing + amount);
      }
    }

    // Find Table 3 start - look for "לא כולל ניגרת" header
    let table3StartRow = -1;
    for (let i = table2EndRow; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row) continue;

      // Check columns 4-6 for the "לא כולל ניגרת" indicator
      for (let col = 4; col <= 6; col++) {
        const cellValue = String(row[col] || "").trim();
        if (cellValue.includes("לא כולל ניגרת")) {
          table3StartRow = i + 1; // Data starts on next row
          break;
        }
      }
      if (table3StartRow >= 0) break;
    }

    // If Table 3 found, extract its data
    if (table3StartRow >= 0) {
      // Find the end of Table 3 (look for "Grand Total" row)
      let table3EndRow = rawData.length;
      for (let i = table3StartRow; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row) continue;
        const categoryCell = String(row[4] || "").trim();
        if (categoryCell === "Grand Total") {
          table3EndRow = i;
          break;
        }
      }

      // Extract data from Table 3 (same column structure as Table 2)
      for (let i = table3StartRow; i < table3EndRow; i++) {
        const row = rawData[i];
        if (!row) continue;

        const categoryCell = String(row[4] || "").trim();
        const customerCell = String(row[5] || "").trim();
        const amountCell = String(row[6] || "").trim();

        // Skip if not a valid category
        if (!VALID_CATEGORIES.includes(categoryCell)) {
          continue;
        }

        // Skip if no customer name
        if (!customerCell) {
          continue;
        }

        const amount = parseFloat(amountCell.replace(/[,\s]/g, ""));
        if (!isNaN(amount) && amount !== 0) {
          const existing = table3Amounts.get(customerCell) || 0;
          table3Amounts.set(customerCell, existing + amount);
        }
      }
    } else {
      // Table 3 not found - add warning
      warnings.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Could not find Table 3 (לא כולל ניגרת). Commission will be calculated from Table 2 amounts.",
        })
      );
      legacyWarnings.push("Could not find Table 3 (לא כולל ניגרת). Commission will be calculated from Table 2 amounts.");
    }

    // Merge data: Table 2 provides netAmount, Table 3 provides commission basis
    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let rowNumber = 1;

    // Get all unique franchisee names from both tables
    const allFranchisees = new Set([...table2Amounts.keys(), ...table3Amounts.keys()]);

    for (const franchisee of allFranchisees) {
      const table2Amount = table2Amounts.get(franchisee);
      const table3Amount = table3Amounts.get(franchisee);

      // Skip if only in Table 3 (unusual case - warn and skip)
      if (table2Amount === undefined && table3Amount !== undefined) {
        warnings.push(
          createFileProcessingError("PARSE_ERROR", {
            details: `Franchisee "${franchisee}" found only in Table 3, skipping.`,
          })
        );
        continue;
      }

      // Use Table 2 amount for netAmount (for cross-reference)
      const netAmount = roundToTwoDecimals(table2Amount!);
      if (netAmount <= 0) continue;

      const grossAmount = roundToTwoDecimals(netAmount * (1 + VAT_RATE));

      // Calculate commission: use Table 3 amount if available, otherwise fallback to Table 2
      const commissionBasis = table3Amount !== undefined ? table3Amount : table2Amount!;
      const preCalculatedCommission = roundToTwoDecimals(commissionBasis * COMMISSION_RATE);

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
      rawData.length - processedRows,
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
