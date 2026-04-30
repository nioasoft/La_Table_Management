/**
 * Custom parser for עלה עלה (ALE_ALE) supplier files
 *
 * Two layouts supported (auto-detected from buffer signature):
 *
 * LEGACY layout (Windows-1255 CSV, per-product rows):
 *   - Row 0: Headers (תקופה, שם לקוח, מקט, שם פריט, כמות, מחיר, מחיר תקליט, סהכ לפריט)
 *   - Row 1+: Per-product rows. Aggregate by customer (col B), use col H as net.
 *   - VAT: amounts are NET; supports per-item VAT via vatProducts.
 *
 * NEW layout (binary .xls "ריכוז מכירות ללקוחות" — sales summary):
 *   - Row 0: Filter info row
 *   - Row 1: Title + headers ("ריכוז מכירות ללקוחות" appears here)
 *   - Row 2+: One aggregated row per customer
 *       col B (1): gross amount with VAT
 *       col C (2): customer name
 *       col D (3): customer card / ID
 *   - Last rows include "סה״כ מכירות" total + "מערכת תוכנה" footer (skip).
 *   - VAT: amount is GROSS; back-calculate net = gross / 1.18.
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

// Legacy column indices
const LEGACY_DATE_COL = 0;
const LEGACY_FRANCHISEE_COL = 1;
const LEGACY_PRODUCT_NAME_COL = 3;
const LEGACY_AMOUNT_COL = 7;

// New layout column indices
const NEW_GROSS_COL = 1;
const NEW_FRANCHISEE_COL = 2;

const NEW_LAYOUT_TITLE = "ריכוז מכירות ללקוחות";
const NEW_SKIP_KEYWORDS = ['סה"כ', "סהכ", "מערכת תוכנה"];

/**
 * Detect whether the buffer is the new binary .xls "sales summary" layout or
 * the legacy Windows-1255 CSV. Cheap heuristic: try to read as binary; if
 * the resulting first sheet has the title "ריכוז מכירות ללקוחות" anywhere in
 * the first two rows, treat as new layout.
 */
function isNewLayout(buffer: Buffer): boolean {
  try {
    const wb = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetName = wb.SheetNames[0];
    if (!sheetName) return false;
    const rows: unknown[][] = XLSX.utils.sheet_to_json(wb.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
    });
    for (let i = 0; i < Math.min(rows.length, 3); i++) {
      const row = rows[i] || [];
      const joined = row.map((c) => String(c || "")).join(" ");
      if (joined.includes(NEW_LAYOUT_TITLE)) return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function parseAleAleFile(
  buffer: Buffer,
  vatRate: number = ISRAEL_VAT_RATE,
  vatProducts?: Set<string>
): FileProcessingResult {
  if (isNewLayout(buffer)) {
    return parseNewLayoutXls(buffer);
  }
  return parseLegacyCsv(buffer, vatRate, vatProducts);
}

function parseNewLayoutXls(buffer: Buffer): FileProcessingResult {
  const errors: import("../file-processing-errors").FileProcessingError[] = [];
  const warnings: import("../file-processing-errors").FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];

  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
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

    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processed = 0;
    let skipped = 0;
    let rowNumber = 1;

    // Data starts at row 2 (after filter row + header row)
    for (let i = 2; i < rawData.length; i++) {
      const row = rawData[i] || [];
      if (row.length === 0) {
        skipped++;
        continue;
      }

      const franchisee = String(row[NEW_FRANCHISEE_COL] || "").trim();
      const grossStr = String(row[NEW_GROSS_COL] || "").trim();

      // Skip summary / footer rows
      const joined = row.map((c) => String(c || "")).join(" ");
      if (NEW_SKIP_KEYWORDS.some((kw) => joined.includes(kw))) {
        skipped++;
        continue;
      }

      if (!franchisee || !grossStr) {
        skipped++;
        continue;
      }

      const gross = parseFloat(grossStr.replace(/[,\s₪]/g, ""));
      if (isNaN(gross) || gross <= 0) {
        skipped++;
        continue;
      }

      // ALE_ALE new layout reports GROSS (with VAT). Back-calc net.
      const grossRounded = roundAmount(gross);
      const netRounded = roundAmount(gross / (1 + ISRAEL_VAT_RATE));

      data.push({
        franchisee,
        date: null,
        grossAmount: grossRounded,
        netAmount: netRounded,
        originalAmount: grossRounded,
        rowNumber: rowNumber++,
      });

      totalGrossAmount += grossRounded;
      totalNetAmount += netRounded;
      processed++;
    }

    if (processed === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Could not extract any franchisee data from the new-layout file",
        })
      );
      legacyErrors.push("Could not extract any franchisee data from the new-layout file");
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
      processed,
      skipped,
      totalGrossAmount,
      totalNetAmount
    );
    // VAT was added by us (not in source), so flag accordingly.
    result.summary.vatAdjusted = true;
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

function parseLegacyCsv(
  buffer: Buffer,
  vatRate: number,
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

    const franchiseeAmounts: Map<
      string,
      { netAmount: number; grossAmount: number; date: string | null }
    > = new Map();
    const uniqueProducts = new Set<string>();

    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) continue;

      const franchisee = String(row[LEGACY_FRANCHISEE_COL] || "").trim();
      const amountStr = String(row[LEGACY_AMOUNT_COL] || "").trim();
      const dateStr = String(row[LEGACY_DATE_COL] || "").trim();
      const productName = String(row[LEGACY_PRODUCT_NAME_COL] || "").trim();

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
