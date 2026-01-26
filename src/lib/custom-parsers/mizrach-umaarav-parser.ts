/**
 * Custom parser for מזרח ומערב (MIZRACH_UMAARAV) supplier files
 *
 * File structure:
 *   The file contains TWO separate sections with different commission rates:
 *
 *   Section 1 (17%):
 *   - Row 0: Title "קאסטרה 17% רבעון X"
 *   - Row 2: Headers (מס' לקוח, שם לקוח, אוק, נוב, דצמ, סכום כולל)
 *   - Row 3+: Data rows
 *   - Ends with "סכום כולל" row
 *
 *   Section 2 (10%):
 *   - Starts after empty rows following section 1
 *   - Row N: Title "קאסטרה 10% רבעון X"
 *   - Row N+2: Headers
 *   - Row N+3+: Data rows
 *   - Ends with "סכום כולל" row
 *
 * Solution:
 *   - Detect section boundaries by looking for "17%" and "10%" in titles
 *   - Parse each section and collect amounts per franchisee
 *   - Aggregate same franchisee from different sections into one row
 *   - Calculate preCalculatedCommission = (amount17 * 0.17) + (amount10 * 0.10)
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

// Commission rates
const COMMISSION_RATE_17 = 0.17;
const COMMISSION_RATE_10 = 0.10;

interface Section {
  commissionRate: number;
  startRow: number;
  headerRow: number;
  dataStartRow: number;
  dataEndRow: number;
}

interface FranchiseeAmounts {
  amount17: number; // Sum of amounts from 17% section
  amount10: number; // Sum of amounts from 10% section
  firstRowNumber: number; // First row where this franchisee appeared
}

/**
 * Parse currency string to number (handles parentheses for negative)
 */
function parseCurrency(value: unknown): number {
  if (value === null || value === undefined || value === "") return 0;

  let str = String(value).trim();

  // Handle negative numbers in parentheses: (1,234) -> -1234
  const isNegative = str.startsWith("(") && str.endsWith(")");
  if (isNegative) {
    str = str.slice(1, -1);
  }

  // Remove currency symbols, commas, spaces
  str = str.replace(/[₪,\s]/g, "");

  // Handle dash for zero
  if (str === "-" || str === "") return 0;

  const num = parseFloat(str);
  if (isNaN(num)) return 0;

  return isNegative ? -num : num;
}

/**
 * Detect sections in the file by looking for title rows with percentage
 */
function detectSections(data: unknown[][]): Section[] {
  const sections: Section[] = [];

  for (let i = 0; i < data.length; i++) {
    const row = data[i];
    if (!row || !row[0]) continue;

    const firstCell = String(row[0]).trim();

    // Look for section titles like "קאסטרה 17% רבעון" or "קאסטרה 10% רבעון"
    const match17 = firstCell.includes("17%");
    const match10 = firstCell.includes("10%");

    if (match17 || match10) {
      const commissionRate = match17 ? 17 : 10;

      // Find header row (contains "מס' לקוח" and "שם לקוח")
      let headerRow = -1;
      for (let j = i + 1; j < Math.min(i + 5, data.length); j++) {
        const checkRow = data[j];
        if (checkRow && String(checkRow[0] || "").includes("מס' לקוח")) {
          headerRow = j;
          break;
        }
      }

      if (headerRow === -1) continue;

      // Find data end (row with "סכום כולל" in first column)
      let dataEndRow = data.length;
      for (let j = headerRow + 1; j < data.length; j++) {
        const checkRow = data[j];
        if (checkRow && String(checkRow[0] || "").includes("סכום כולל")) {
          dataEndRow = j;
          break;
        }
      }

      sections.push({
        commissionRate,
        startRow: i,
        headerRow,
        dataStartRow: headerRow + 1,
        dataEndRow,
      });
    }
  }

  return sections;
}

/**
 * Parse מזרח ומערב supplier file with multiple commission rate sections
 * Aggregates same franchisee from different sections and calculates commission
 */
export function parseMizrachUmaaravFile(buffer: Buffer): FileProcessingResult {
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

    // Detect sections
    const sections = detectSections(rawData);

    if (sections.length === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Could not detect any commission sections (17% or 10%) in the file",
        })
      );
      legacyErrors.push("Could not detect any commission sections in the file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rawData.length);
    }

    // Map to aggregate amounts by franchisee name
    const franchiseeMap = new Map<string, FranchiseeAmounts>();

    // Process each section and aggregate by franchisee
    for (const section of sections) {
      // Column indices based on the header structure:
      // A: מס' לקוח, B: שם לקוח, C-E: months, F: סכום כולל
      const franchiseeColIndex = 1; // Column B - שם לקוח
      const totalColIndex = 5; // Column F - סכום כולל

      for (let i = section.dataStartRow; i < section.dataEndRow; i++) {
        const row = rawData[i];
        if (!row) continue;

        const franchiseeName = String(row[franchiseeColIndex] || "").trim();
        const totalAmount = parseCurrency(row[totalColIndex]);

        // Skip empty rows or rows with zero/negative total
        if (!franchiseeName || totalAmount <= 0) continue;

        // Get or create entry for this franchisee
        let entry = franchiseeMap.get(franchiseeName);
        if (!entry) {
          entry = {
            amount17: 0,
            amount10: 0,
            firstRowNumber: i + 1,
          };
          franchiseeMap.set(franchiseeName, entry);
        }

        // Add amount to the appropriate commission rate bucket
        if (section.commissionRate === 17) {
          entry.amount17 += totalAmount;
        } else {
          entry.amount10 += totalAmount;
        }
      }
    }

    // Convert aggregated data to ParsedRowData
    let totalNetAmount = 0;
    let totalGrossAmount = 0;
    let totalPreCalculatedCommission = 0;
    let processedRows = 0;
    let rowNumber = 1;

    // Sort franchisees alphabetically
    const sortedFranchisees = Array.from(franchiseeMap.entries()).sort((a, b) =>
      a[0].localeCompare(b[0], "he")
    );

    for (const [franchiseeName, amounts] of sortedFranchisees) {
      // Calculate total net amount (sum of both sections)
      const netAmount = roundToTwoDecimals(amounts.amount17 + amounts.amount10);
      const grossAmount = roundToTwoDecimals(netAmount * (1 + VAT_RATE));

      // Calculate pre-calculated commission based on rates
      const preCalculatedCommission = roundToTwoDecimals(
        (amounts.amount17 * COMMISSION_RATE_17) + (amounts.amount10 * COMMISSION_RATE_10)
      );

      data.push({
        franchisee: franchiseeName,
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

    // Add info about sections found
    const sectionsSummary = sections.map(s => `${s.commissionRate}%`).join(", ");
    if (sections.length > 0) {
      warnings.push(
        createFileProcessingError("PARSE_ERROR", {
          details: `זוהו ${sections.length} קטעי עמלות: ${sectionsSummary}`,
        })
      );
      legacyWarnings.push(`זוהו ${sections.length} קטעי עמלות: ${sectionsSummary}`);
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
