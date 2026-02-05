/**
 * Custom parser for עלה עלה (ALE_ALE) supplier files
 *
 * Problem: File is encoded in Windows-1255 (Hebrew encoding)
 * The generic parser can't decode it properly.
 *
 * Structure:
 *   - Row 1: Headers (תקופה, שם לקוח, מקט, שם פריט, כמות, מחיר, מחיר תקליט, סהכ לפריט)
 *   - Row 2+: Data rows with product-level details
 *   - Multiple rows per franchisee (one per product)
 *
 * Column mapping:
 *   - Column A (0): תקופה - Period/Date (e.g., "אוקטובר 2025")
 *   - Column B (1): שם לקוח - Franchisee name
 *   - Column H (7): סהכ לפריט - Amount per item (net, before VAT)
 *
 * VAT: Amounts are NET (vatIncluded: false) - need to calculate gross from net
 */

import * as XLSX from "xlsx";
import iconv from "iconv-lite";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundToTwoDecimals,
  ISRAEL_VAT_RATE,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

// Column indices
const DATE_COL = 0; // Column A
const FRANCHISEE_COL = 1; // Column B
const PRODUCT_NAME_COL = 3; // Column D - שם פריט
const AMOUNT_COL = 7; // Column H

/**
 * Parse עלה עלה supplier file with Windows-1255 encoding
 *
 * @param vatProducts - Set of product names that have VAT. When provided,
 *   only these products get VAT added to gross. When undefined, all products
 *   get blanket VAT calculation.
 */
export function parseAleAleFile(
  buffer: Buffer,
  vatRate: number = ISRAEL_VAT_RATE,
  vatProducts?: Set<string>
): FileProcessingResult {
  const errors: import("../file-processing-errors").FileProcessingError[] = [];
  const warnings: import("../file-processing-errors").FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];

  try {
    // Convert from Windows-1255 to UTF-8
    const decoded = iconv.decode(buffer, "windows-1255");

    // Parse the decoded CSV with XLSX
    const workbook = XLSX.read(decoded, {
      type: "string",
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

    if (!rawData || rawData.length < 2) {
      errors.push(createFileProcessingError("FILE_EMPTY"));
      legacyErrors.push("File is empty or too short");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    // Aggregate amounts by franchisee, tracking net and gross separately
    // for per-item VAT calculation
    const franchiseeAmounts: Map<string, {
      netAmount: number;
      grossAmount: number;
      date: string | null;
    }> = new Map();

    // Collect unique product names for syncing to supplier_product table
    const uniqueProducts = new Set<string>();

    // Start from row 2 (index 1) - skip header
    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) continue;

      const franchisee = String(row[FRANCHISEE_COL] || "").trim();
      const amountStr = String(row[AMOUNT_COL] || "").trim();
      const dateStr = String(row[DATE_COL] || "").trim();
      const productName = String(row[PRODUCT_NAME_COL] || "").trim();

      if (productName) uniqueProducts.add(productName);

      if (!franchisee) {
        continue;
      }

      // Parse amount - remove commas and convert to number
      const amount = parseFloat(amountStr.replace(/[,\s]/g, ""));
      if (isNaN(amount) || amount === 0) {
        continue;
      }

      // Per-item VAT: if vatProducts is provided, only VAT-applicable products get VAT
      // If vatProducts is undefined, all products get VAT (blanket calculation)
      const itemNet = amount;
      const isVatProduct = vatProducts
        ? vatProducts.has(productName)
        : true; // default: all products get VAT when no per-item config
      const itemGross = isVatProduct ? amount * (1 + vatRate) : amount;

      // Aggregate
      const existing = franchiseeAmounts.get(franchisee);
      if (existing) {
        existing.netAmount += itemNet;
        existing.grossAmount += itemGross;
        if (!existing.date) existing.date = dateStr;
      } else {
        franchiseeAmounts.set(franchisee, {
          netAmount: itemNet,
          grossAmount: itemGross,
          date: dateStr,
        });
      }
    }

    // Convert to ParsedRowData
    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let rowNumber = 1;

    for (const [franchisee, franchiseeData] of franchiseeAmounts.entries()) {
      if (franchiseeData.netAmount <= 0) {
        warnings.push(
          createFileProcessingError("NEGATIVE_AMOUNT", {
            rowNumber,
            details: `Skipping negative/zero amount ${franchiseeData.netAmount} for "${franchisee}"`,
            value: String(franchiseeData.netAmount),
          })
        );
        legacyWarnings.push(`Skipping negative/zero amount ${franchiseeData.netAmount} for "${franchisee}"`);
        continue;
      }

      const netAmount = roundToTwoDecimals(franchiseeData.netAmount);
      const grossAmount = roundToTwoDecimals(franchiseeData.grossAmount);

      // Parse Hebrew date (e.g., "אוקטובר 2025")
      const parsedDate = parseHebrewDate(franchiseeData.date);

      data.push({
        franchisee,
        date: parsedDate,
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

    const result = createResult(
      true,
      data,
      errors,
      warnings,
      legacyErrors,
      legacyWarnings,
      rawData.length,
      processedRows,
      rawData.length - 1 - processedRows,
      totalGrossAmount,
      totalNetAmount
    );

    // Attach extracted product names for syncing to supplier_product table
    if (uniqueProducts.size > 0) {
      result.summary.extractedProducts = [...uniqueProducts];
    }

    return result;
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

/**
 * Parse Hebrew month date string (e.g., "אוקטובר 2025")
 */
function parseHebrewDate(dateStr: string | null): Date | null {
  if (!dateStr) return null;

  const hebrewMonths: Record<string, number> = {
    ינואר: 0,
    פברואר: 1,
    מרץ: 2,
    אפריל: 3,
    מאי: 4,
    יוני: 5,
    יולי: 6,
    אוגוסט: 7,
    ספטמבר: 8,
    אוקטובר: 9,
    נובמבר: 10,
    דצמבר: 11,
  };

  const parts = dateStr.trim().split(/\s+/);
  if (parts.length !== 2) return null;

  const [monthStr, yearStr] = parts;
  const month = hebrewMonths[monthStr];
  const year = parseInt(yearStr, 10);

  if (month === undefined || isNaN(year)) return null;

  // Return first day of the month
  return new Date(year, month, 1);
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
