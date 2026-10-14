/**
 * Custom parser for מעדני הטבע (MAADANEI_HATEVA) supplier files
 *
 * Problem: File has multiple rows per franchisee (different products)
 * Structure:
 *   - Sheet: "DataSheet"
 *   - Row 1: Headers
 *   - "שם לקוח": Franchisee name
 *   - Amount: "הכנסה" (per-product report, col G) or "סכום בשקלים"
 *     (per-month report from Q3-2026, col F) — located by header
 *
 * The parser aggregates all rows by franchisee and returns one total per franchisee.
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundAmount,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

// Row configuration
const HEADER_ROW = 0; // Row 1 (0-indexed)
const DATA_START_ROW = 1; // Row 2 (0-indexed)

// Sheet name
const SHEET_NAME = "DataSheet";

// Skip keywords
const SKIP_KEYWORDS = ['סה"כ', "סהכ", "total", "grand"];

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
 * Check if a row should be skipped
 */
function shouldSkipRow(row: unknown[]): boolean {
  const rowText = row.map((cell) => String(cell || "").toLowerCase()).join(" ");
  return SKIP_KEYWORDS.some((keyword) =>
    rowText.includes(keyword.toLowerCase())
  );
}

/**
 * Parse מעדני הטבע supplier file with aggregation by franchisee
 */
export function parseMaadaneiHatevaFile(buffer: Buffer): FileProcessingResult {
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

    // Find the target sheet
    let sheetName = SHEET_NAME;
    if (!workbook.SheetNames.includes(sheetName)) {
      sheetName = workbook.SheetNames[0];
      warnings.push(
        createFileProcessingError("PARSE_ERROR", {
          details: `Configured sheet "${SHEET_NAME}" not found, using "${sheetName}"`,
        })
      );
      legacyWarnings.push(
        `Configured sheet "${SHEET_NAME}" not found, using "${sheetName}"`
      );
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
      legacyErrors.push("File is empty or too short");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    // Locate columns by header — the supplier switches report layouts.
    // No positional fallback: a wrong column parses silently as ₪0.
    const headers = (rawData[HEADER_ROW] || []).map((h) => String(h || ""));
    const FRANCHISEE_COL = headers.findIndex((h) => h.includes("שם לקוח"));
    const incomeCol = headers.findIndex((h) => h.includes("הכנסה"));
    const AMOUNT_COL = incomeCol >= 0 ? incomeCol : headers.findIndex((h) => h.includes("סכום"));

    const missing = [
      FRANCHISEE_COL < 0 && "שם לקוח",
      AMOUNT_COL < 0 && "הכנסה / סכום בשקלים",
    ].filter(Boolean);
    if (missing.length > 0) {
      const details = `Missing column header(s): ${missing.join(", ")}`;
      errors.push(createFileProcessingError("PARSE_ERROR", { details }));
      legacyErrors.push(details);
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rawData.length);
    }

    // Aggregate amounts by franchisee
    const franchiseeTotals: Map<string, { amount: number; rowCount: number; firstRow: number }> = new Map();
    let skippedRows = 0;

    for (let rowIdx = DATA_START_ROW; rowIdx < rawData.length; rowIdx++) {
      const row = rawData[rowIdx];
      if (!row || row.length === 0) {
        skippedRows++;
        continue;
      }

      // Skip summary rows
      if (shouldSkipRow(row)) {
        skippedRows++;
        continue;
      }

      // Extract values
      const franchisee = String(row[FRANCHISEE_COL] || "").trim();
      const amount = parseNumericValue(row[AMOUNT_COL]);

      // Skip rows without franchisee name
      if (!franchisee) {
        warnings.push(
          createFileProcessingError("EMPTY_FRANCHISEE_NAME", {
            rowNumber: rowIdx + 1,
          })
        );
        legacyWarnings.push(`Row ${rowIdx + 1}: Empty franchisee name`);
        skippedRows++;
        continue;
      }

      // Skip rows with zero amount
      if (amount === 0) {
        warnings.push(
          createFileProcessingError("ZERO_AMOUNT", {
            rowNumber: rowIdx + 1,
            details: `Skipping row with zero amount for "${franchisee}"`,
          })
        );
        skippedRows++;
        continue;
      }

      // Get or create franchisee totals
      const existing = franchiseeTotals.get(franchisee) || {
        amount: 0,
        rowCount: 0,
        firstRow: rowIdx + 1
      };

      // Add to totals (including negative amounts for returns/credits)
      existing.amount += amount;
      existing.rowCount++;

      franchiseeTotals.set(franchisee, existing);
    }

    // Convert aggregated data to ParsedRowData
    let totalAmount = 0;
    let processedFranchisees = 0;
    let rowNumber = 1;

    for (const [franchisee, totals] of franchiseeTotals.entries()) {
      // Skip franchisees with zero or negative total (after aggregation)
      if (totals.amount <= 0) {
        warnings.push(
          createFileProcessingError("NEGATIVE_AMOUNT", {
            rowNumber: totals.firstRow,
            details: `Franchisee "${franchisee}" has non-positive total after aggregation: ${totals.amount} (${totals.rowCount} rows)`,
            value: String(totals.amount),
          })
        );
        continue;
      }

      // The amount appears to be without VAT based on file analysis
      const netAmount = roundAmount(totals.amount);
      const grossAmount = roundAmount(totals.amount * 1.18);

      data.push({
        franchisee,
        date: null,
        grossAmount,
        netAmount,
        originalAmount: netAmount,
        rowNumber: rowNumber++,
      });

      totalAmount += netAmount;
      processedFranchisees++;
    }

    if (processedFranchisees === 0) {
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
      processedFranchisees,
      skippedRows,
      roundAmount(totalAmount * 1.18),
      totalAmount
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
      totalGrossAmount: roundAmount(totalGrossAmount),
      totalNetAmount: roundAmount(totalNetAmount),
      vatAdjusted: false,
    },
  };
}
