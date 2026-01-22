/**
 * Custom parser for אספיריט (ASPIRIT) supplier files
 *
 * Problem: File contains item-level detail (one row per product per franchisee)
 * Structure:
 *   - Row 0: Headers (מס. לקוח, שם לקוח, מק'ט, תאור מוצר, כמות, יח', הכנסה, מטבע, ...)
 *   - Row 1+: Data rows with one row per product
 *
 * Solution: Aggregate amounts by franchisee name (column B)
 * Amount column: G (index 6) - "הכנסה"
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

// Column indices (0-based)
const FRANCHISEE_COL = 1; // Column B - שם לקוח
const AMOUNT_COL = 6;     // Column G - הכנסה

/**
 * Parse אספיריט supplier file - aggregates item-level data by franchisee
 */
export function parseAspiritFile(buffer: Buffer): FileProcessingResult {
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

    // Find the data sheet
    let sheetName: string | undefined = workbook.SheetNames.find((name) => name === "DataSheet");
    if (!sheetName) {
      sheetName = workbook.SheetNames[0];
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

    // Aggregate amounts by franchisee
    const franchiseeAmounts: Map<string, number> = new Map();
    let skippedRows = 0;

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

      // Skip total/summary rows
      if (
        franchisee.includes("סה״כ") ||
        franchisee.includes("סה\"כ") ||
        franchisee.includes("סהכ") ||
        franchisee.includes("סכום")
      ) {
        skippedRows++;
        continue;
      }

      // Parse amount - remove commas and spaces
      const amount = parseFloat(amountStr.replace(/[,\s]/g, ""));

      if (isNaN(amount)) {
        skippedRows++;
        continue;
      }

      // Aggregate by franchisee
      const existing = franchiseeAmounts.get(franchisee) || 0;
      franchiseeAmounts.set(franchisee, existing + amount);
    }

    // Convert to ParsedRowData
    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let rowNumber = 1;

    for (const [franchisee, amount] of franchiseeAmounts.entries()) {
      if (amount === 0) continue;

      // Amounts in file are net (without VAT)
      const netAmount = roundToTwoDecimals(amount);
      const grossAmount = roundToTwoDecimals(amount * (1 + VAT_RATE));

      data.push({
        franchisee,
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
