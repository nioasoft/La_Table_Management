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
 *   - Parse each section separately
 *   - Include commission rate in franchisee name for clarity: "זכיין (17%)" or "זכיין (10%)"
 *   - This allows the UI to display and group by commission rate
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

interface Section {
  commissionRate: number;
  startRow: number;
  headerRow: number;
  dataStartRow: number;
  dataEndRow: number;
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

    // Process each section
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

        // Include commission rate in franchisee name for display clarity
        const fullName = `${franchiseeName} (${section.commissionRate}%)`;

        // Amounts in file are before VAT (net)
        const netAmount = roundToTwoDecimals(totalAmount);
        const grossAmount = roundToTwoDecimals(netAmount * (1 + VAT_RATE));

        data.push({
          franchisee: fullName,
          date: null,
          grossAmount,
          netAmount,
          originalAmount: netAmount,
          rowNumber: i + 1,
        });
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

    // Sort by commission rate (17% first, then 10%) and then by name
    data.sort((a, b) => {
      const rateA = a.franchisee.includes("(17%)") ? 17 : 10;
      const rateB = b.franchisee.includes("(17%)") ? 17 : 10;
      if (rateB !== rateA) return rateB - rateA; // 17% first
      return a.franchisee.localeCompare(b.franchisee, "he");
    });

    // Renumber rows sequentially after sorting
    data.forEach((row, index) => {
      row.rowNumber = index + 1;
    });

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
