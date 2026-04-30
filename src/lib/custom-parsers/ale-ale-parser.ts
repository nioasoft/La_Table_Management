/**
 * Custom parser for עלה עלה (ALE_ALE) supplier files
 *
 * Two CSV layouts supported (auto-detected from headers in row 0):
 *
 * LEGACY layout (8-column Windows-1255 CSV):
 *   - Headers: [תקופה, שם לקוח, מקט, שם פריט, כמות, מחיר, מחיר תקליט, סהכ לפריט]
 *   - Per-product rows. Aggregate by customer (col B), use col H (idx 7) as net.
 *
 * NEW layout (7-column Windows-1255 CSV):
 *   - Headers: [תקופה, שם לקוח, מקט, שם פריט, כמות, מחיר, סהכ לפריט]
 *   - "מחיר תקליט" was dropped, so the line total moves from col H (idx 7)
 *     to col G (idx 6).
 *
 * VAT: amounts are NET; supports per-item VAT via vatProducts.
 */

import * as XLSX from "xlsx";
import iconv from "iconv-lite";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundAmount,
  ISRAEL_VAT_RATE,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

// Common to both layouts
const DATE_COL = 0;
const FRANCHISEE_COL = 1;
const PRODUCT_NAME_COL = 3;

// Layout-specific amount column
const LEGACY_AMOUNT_COL = 7;
const NEW_AMOUNT_COL = 6;

const LEGACY_TOTAL_HEADER = "סהכ לפריט";
const LEGACY_RECORDPRICE_HEADER = "מחיר תקליט";

/**
 * Pick the right amount column based on the header row. Defaults to legacy
 * if headers are unclear so existing callers don't regress.
 */
function pickAmountCol(headers: unknown[]): number {
  const h7 = String(headers[7] || "");
  const h6 = String(headers[6] || "");
  if (h7.includes(LEGACY_TOTAL_HEADER) || h7.includes(LEGACY_RECORDPRICE_HEADER)) {
    return LEGACY_AMOUNT_COL;
  }
  if (h6.includes(LEGACY_TOTAL_HEADER)) {
    return NEW_AMOUNT_COL;
  }
  return LEGACY_AMOUNT_COL;
}

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
    const decoded = iconv.decode(buffer, "windows-1255");
    const workbook = XLSX.read(decoded, { type: "string", cellDates: true });

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

    const amountCol = pickAmountCol(rawData[0] || []);

    const franchiseeAmounts: Map<
      string,
      { netAmount: number; grossAmount: number; date: string | null }
    > = new Map();
    const uniqueProducts = new Set<string>();

    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) continue;

      const franchisee = String(row[FRANCHISEE_COL] || "").trim();
      const amountStr = String(row[amountCol] || "").trim();
      const dateStr = String(row[DATE_COL] || "").trim();
      const productName = String(row[PRODUCT_NAME_COL] || "").trim();

      if (productName) uniqueProducts.add(productName);
      if (!franchisee) continue;

      const amount = parseFloat(amountStr.replace(/[,\s]/g, ""));
      if (isNaN(amount) || amount === 0) continue;

      const itemNet = amount;
      const isVatProduct = vatProducts ? vatProducts.has(productName) : true;
      const itemGross = isVatProduct ? amount * (1 + vatRate) : amount;

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

      const netAmount = roundAmount(franchiseeData.netAmount);
      const grossAmount = roundAmount(franchiseeData.grossAmount);
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
      totalGrossAmount: roundAmount(totalGrossAmount),
      totalNetAmount: roundAmount(totalNetAmount),
      vatAdjusted: false,
    },
  };
}
