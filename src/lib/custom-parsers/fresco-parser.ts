/**
 * Custom parser for פרסקו (FRESCO) supplier files
 *
 * Structure:
 *   - Two sheets: "גיליון2" (summary) and "DataSheet" (details)
 *   - Use "גיליון2" which has aggregated data per franchisee
 *   - Row 0: Headers ("תוויות שורה", "סכום של סכום (ש'ח)")
 *   - Rows 1-N: Franchisee data (name in col A, amount in col B)
 *   - Last row: "סכום כולל" (total) - skip this
 *
 * Note: Amounts appear to be net (without VAT)
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
const FRANCHISEE_COL = 0;
const AMOUNT_COL = 1;

/**
 * Parse פרסקו supplier file - uses גיליון2 for summarized data
 */
export function parseFrescoFile(buffer: Buffer): FileProcessingResult {
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

    // Find the summary sheet (גיליון2)
    let sheetName = workbook.SheetNames.find(
      (name) => name.includes("גיליון2") || name.includes("גליון2")
    );

    if (!sheetName) {
      // Fallback to first sheet if גיליון2 not found
      sheetName = workbook.SheetNames[0];
      warnings.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Sheet 'גיליון2' not found, using first sheet",
        })
      );
      legacyWarnings.push("Sheet 'גיליון2' not found, using first sheet");
    }

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

    if (!rawData || rawData.length < 2) {
      errors.push(createFileProcessingError("FILE_EMPTY"));
      legacyErrors.push("File is empty or has no data rows");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let skippedRows = 0;
    let rowNumber = 1;

    // Start from row 1 (skip header row 0)
    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) {
        skippedRows++;
        continue;
      }

      const franchisee = String(row[FRANCHISEE_COL] || "").trim();
      const amountStr = String(row[AMOUNT_COL] || "").trim();

      // Skip empty rows
      if (!franchisee || !amountStr) {
        skippedRows++;
        continue;
      }

      // Skip total row
      if (franchisee.includes("סכום כולל") || franchisee.includes("סה״כ") || franchisee.includes("סהכ")) {
        skippedRows++;
        continue;
      }

      // Parse amount - remove commas and spaces
      const netAmount = parseFloat(amountStr.replace(/[,\s]/g, ""));

      if (isNaN(netAmount) || netAmount === 0) {
        skippedRows++;
        continue;
      }

      const grossAmount = roundToTwoDecimals(netAmount * (1 + VAT_RATE));
      const roundedNetAmount = roundToTwoDecimals(netAmount);

      data.push({
        franchisee,
        date: null,
        grossAmount,
        netAmount: roundedNetAmount,
        originalAmount: roundedNetAmount,
        rowNumber: rowNumber++,
      });

      totalNetAmount += roundedNetAmount;
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
