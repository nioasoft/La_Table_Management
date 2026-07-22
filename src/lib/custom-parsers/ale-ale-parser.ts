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
 * 2026-Q2 layout: columns reshuffled again —
 *   [תקופה, שם לקוח, שם פריט, כמות, מחיר, מחיר תקליט, סהכ לפריט, מקט].
 *   The supplier keeps moving columns between exports, so columns are now
 *   located BY HEADER NAME with the legacy indices as fallback.
 *
 * VAT: amounts are NET; supports per-item VAT via vatProducts (matched by
 * product NAME — locating שם פריט correctly is what makes per-item VAT work).
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

// Legacy fallback indices (used only when a header isn't found by name)
const LEGACY_DATE_COL = 0;
const LEGACY_FRANCHISEE_COL = 1;
const LEGACY_PRODUCT_NAME_COL = 3;
const LEGACY_AMOUNT_COL = 7;

/**
 * Locate a column by header text, falling back to the legacy index.
 * The supplier reshuffles columns between exports; header names are stable.
 */
function findCol(headers: unknown[], headerText: string, fallback: number): number {
  const idx = headers.findIndex(h => String(h || "").includes(headerText));
  return idx >= 0 ? idx : fallback;
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

    const headers = rawData[0] || [];
    const dateCol = findCol(headers, "תקופה", LEGACY_DATE_COL);
    const franchiseeCol = findCol(headers, "שם לקוח", LEGACY_FRANCHISEE_COL);
    const productNameCol = findCol(headers, "שם פריט", LEGACY_PRODUCT_NAME_COL);
    const amountCol = findCol(headers, "סהכ לפריט", LEGACY_AMOUNT_COL);

    const franchiseeAmounts: Map<
      string,
      { netAmount: number; grossAmount: number; date: string | null }
    > = new Map();
    const uniqueProducts = new Set<string>();

    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) continue;

      const franchisee = String(row[franchiseeCol] || "").trim();
      const amountStr = String(row[amountCol] || "").trim();
      const dateStr = String(row[dateCol] || "").trim();
      const productName = String(row[productNameCol] || "").trim();

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
