/**
 * Custom parser for יוניקו (UNIKO) supplier files
 *
 * File structure:
 *   - Row 0: Brand names at cols 0, 6, 12 (מינה טומאיי, פאט ויני, קינג קונג)
 *   - Row 1: First franchisee names at cols 0, 6, 12
 *   - Row 2: Headers (מק"ט, שם פריט, כמות, מחיר ליחידה, סה"כ) repeating
 *   - Row 3+: Product data with amounts at columns 4, 10, 16
 *   - Total rows: Empty name column but with total amount - this is the franchisee total
 *   - New franchisee sections start when a new name appears in columns 0, 6, or 12
 *
 * Solution: Track each column group independently. Only take the TOTAL rows
 * (where name column is empty but amount column has a value) - these contain
 * the franchisee totals. Skip individual product rows to avoid double-counting.
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

// Brand names to skip
const BRAND_NAMES = ["מינה טומאיי", "פאט ויני", "קינג קונג"];

// Header keywords to skip
const HEADER_KEYWORDS = ['מק"ט', 'שם פריט', 'כמות', 'מחיר ליחידה', 'סה"כ'];

/**
 * Parse currency string to number
 */
function parseCurrency(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;
  const str = String(value).replace(/[₪,\s]/g, "");
  const num = parseFloat(str);
  return isNaN(num) ? 0 : num;
}

/**
 * Check if a string is a product code (starts with letters followed by numbers/dashes)
 */
function isProductCode(str: string): boolean {
  return /^[A-Z]{1,4}[-_]?\d/i.test(str);
}

/**
 * Check if a string is a header keyword
 */
function isHeaderKeyword(str: string): boolean {
  return HEADER_KEYWORDS.some(keyword => str === keyword);
}

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

    // Process each column group independently
    // For each group, track the current franchisee and look for total rows
    for (const group of COLUMN_GROUPS) {
      let currentFranchisee = "";

      for (let i = 0; i < rawData.length; i++) {
        const row = rawData[i];
        if (!row) continue;

        const nameCell = String(row[group.nameCol] || "").trim();
        const amountCell = row[group.amountCol];
        const amount = parseCurrency(amountCell);

        // Check if this is a new franchisee name
        if (nameCell && !isProductCode(nameCell) && !isHeaderKeyword(nameCell) && !BRAND_NAMES.includes(nameCell)) {
          currentFranchisee = nameCell;
          continue;
        }

        // Check if this is a TOTAL row: name column is empty, but amount has a value
        // This is the key fix - we only take the total row, not individual product amounts
        if (!nameCell && amount !== 0 && currentFranchisee) {
          // This is the total for the current franchisee
          const netAmount = roundToTwoDecimals(Math.abs(amount));
          const grossAmount = roundToTwoDecimals(netAmount * (1 + VAT_RATE));

          // Include brand in franchisee name for disambiguation
          const fullName = `${currentFranchisee} (${group.brand})`;

          data.push({
            franchisee: fullName,
            date: null,
            grossAmount,
            netAmount,
            originalAmount: netAmount,
            rowNumber: i + 1,
          });

          // Reset current franchisee after capturing the total
          currentFranchisee = "";
        }
      }
    }

    // Calculate totals
    let totalGrossAmount = 0;
    let totalNetAmount = 0;

    for (const row of data) {
      totalGrossAmount += row.grossAmount;
      totalNetAmount += row.netAmount;
    }

    const processedRows = data.length;

    if (processedRows === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Could not extract any franchisee data from the file",
        })
      );
      legacyErrors.push("Could not extract any franchisee data from the file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rawData.length);
    }

    // Renumber rows sequentially
    data.forEach((row, index) => {
      row.rowNumber = index + 1;
    });

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
