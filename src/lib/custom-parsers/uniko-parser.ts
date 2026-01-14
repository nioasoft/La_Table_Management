/**
 * Custom parser for יוניקו (UNIKO) supplier files
 *
 * Problem: 3 parallel columns for 3 brands, each with their own franchisee sections
 * Structure:
 *   - Row 0: Brand names at cols 0, 6, 12 (מינה טומאיי, פאט ויני, קינג קונג)
 *   - Row 1: First franchisee names at cols 0, 6, 12
 *   - Row 2: Headers (מק"ט, שם פריט, כמות, מחיר ליחידה, סה"כ) repeating
 *   - Row 3+: Product data with סה"כ at columns 4, 10, 16
 *   - New franchisee sections appear when column 0/6/12 has a non-product name
 *
 * Solution: Track each column independently, identify franchisee headers by non-product patterns
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

// Column groups for each brand
const COLUMN_GROUPS = [
  { nameCol: 0, amountCol: 4, brand: "מינה טומאיי" },
  { nameCol: 6, amountCol: 10, brand: "פאט ויני" },
  { nameCol: 12, amountCol: 16, brand: "קינג קונג" },
];

/**
 * Parse יוניקו supplier file with 3 parallel brand columns
 */
export function parseUnikoFile(buffer: Buffer): FileProcessingResult {
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

    // Track franchisee amounts per brand
    const franchiseeAmounts: Map<string, number> = new Map();

    // Process each column group independently
    for (const group of COLUMN_GROUPS) {
      let currentFranchisee = "";

      for (let i = 0; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row) continue;

        const nameCell = String(row[group.nameCol] || "").trim();
        const amountCell = row[group.amountCol];

        // Check if this is a franchisee name (not empty, not a product code, not a header)
        const isProductCode = /^[A-Z]{1,4}[-_]?\d/.test(nameCell);
        const isHeader = nameCell === 'מק"ט' || nameCell === 'סה"כ';
        const isBrand =
          nameCell === "מינה טומאיי" ||
          nameCell === "פאט ויני" ||
          nameCell === "קינג קונג";

        if (nameCell && !isProductCode && !isHeader && !isBrand) {
          currentFranchisee = nameCell;
        }

        // Process amount if we have a current franchisee
        if (currentFranchisee && amountCell) {
          const amountStr = String(amountCell).replace(/[₪,\s]/g, "");
          const amount = parseFloat(amountStr);
          if (!isNaN(amount) && amount !== 0) {
            const key = `${currentFranchisee} (${group.brand})`;
            const existing = franchiseeAmounts.get(key) || 0;
            franchiseeAmounts.set(key, existing + amount);
          }
        }
      }
    }

    // Convert to ParsedRowData
    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let rowNumber = 1;

    for (const [fullName, amount] of franchiseeAmounts.entries()) {
      // Extract franchisee name without brand suffix for the output
      const franchiseeName = fullName.replace(/\s*\([^)]+\)$/, "");

      if (amount <= 0) continue;

      const netAmount = roundToTwoDecimals(amount);
      const grossAmount = roundToTwoDecimals(amount * (1 + VAT_RATE));

      data.push({
        franchisee: fullName, // Keep full name with brand for disambiguation
        date: null,
        grossAmount,
        netAmount,
        originalAmount: netAmount,
        rowNumber: rowNumber++,
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
