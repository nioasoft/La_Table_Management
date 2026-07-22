/**
 * Custom parser for ג'ומון (JUMON) supplier files
 *
 * Problem: File has multiple product rows per franchisee, commission is calculated per row
 * Structure (per sheet):
 *   - Row 1: Headers
 *   - Column A: Customer ID (only filled on first row of each customer block)
 *   - Column B: Franchisee name (only filled on first row of each customer block)
 *   - Column C: Product ID (מק'ט)
 *   - Column F: Product amount (סכום של סכום ש'ח) - PURCHASE amount for cross-reference
 *   - Column G: Commission rate (אחוז עמלת ניהול)
 *   - Column H: Commission amount (סה"כ ניהול לפני מע"מ) - pre-calculated commission
 *
 * The parser identifies customer blocks by rows where column A (customer ID) is filled,
 * then sums column F (purchase amount) for cross-reference with franchisees,
 * and column H (commission amount) as pre-calculated commission.
 *
 * Sheets: ALL sheets are scanned. The supplier's Q1-2026 file has a first
 * sheet containing every customer plus a per-brand breakout sheet duplicating
 * the King Kong customers — so a franchisee already seen with the SAME totals
 * is skipped (breakout duplicate), while a franchisee that only appears on a
 * later sheet (e.g. a brand that gets its own sheet) is included. A duplicate
 * with DIFFERENT totals keeps the first sheet's numbers and emits a warning.
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundAmount,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

// Legacy fallback column indices (0-based) — used when a header isn't found
const LEGACY_FRANCHISEE_COL = 1; // Column B - שם לקוח
const LEGACY_PRODUCT_COL = 2; // Column C - מק'ט
const LEGACY_PRODUCT_AMOUNT_COL = 5; // Column F - סכום של סכום ש'ח
const LEGACY_COMMISSION_AMOUNT_COL = 7; // Column H - סה"כ ניהול לפני מע"מ

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
 * Locate the header row: the first row containing a "שם לקוח" cell.
 * Returns -1 when the sheet has no recognizable header.
 */
function findHeaderRow(rawData: unknown[][]): number {
  const scanLimit = Math.min(rawData.length, 10);
  for (let r = 0; r < scanLimit; r++) {
    const row = rawData[r];
    if (row?.some(c => String(c || "").includes("שם לקוח"))) return r;
  }
  return -1;
}

/** Locate a column by header predicate, falling back to a legacy index */
function findCol(
  headers: unknown[],
  match: (h: string) => boolean,
  fallback: number
): number {
  const idx = headers.findIndex(h => match(String(h || "")));
  return idx >= 0 ? idx : fallback;
}

interface CustomerBlock {
  franchisee: string;
  totalPurchase: number; // Sum of product amounts - for cross-reference
  totalCommission: number; // Sum of commission amounts - pre-calculated
  rowCount: number;
  firstRow: number;
}

/**
 * Parse ג'ומון supplier file with aggregation by customer block
 */
export function parseJumonFile(buffer: Buffer): FileProcessingResult {
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

    if (workbook.SheetNames.length === 0) {
      errors.push(createFileProcessingError("NO_WORKSHEETS"));
      legacyErrors.push("No worksheets found in file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    // Merged blocks across all sheets, keyed by franchisee name.
    // A later sheet repeating a franchisee with the same totals is a
    // per-brand breakout duplicate and is skipped.
    const mergedBlocks = new Map<string, CustomerBlock>();
    let totalRowsAllSheets = 0;
    let skippedRows = 0;

    for (let sheetIdx = 0; sheetIdx < workbook.SheetNames.length; sheetIdx++) {
      const sheet = workbook.Sheets[workbook.SheetNames[sheetIdx]];
      const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
        header: 1,
        raw: false,
        defval: "",
      });

      if (!rawData || rawData.length < 2) continue;
      totalRowsAllSheets += rawData.length;

      // Locate the header row + columns by header text. Layouts seen so far:
      //   standard: [מס' לקוח, שם לקוח, מק'ט, תאור, כמות, סכום של סכום (ש'ח), אחוז, סה"כ ניהול]
      //   new-branch (Q2-2026, e.g. פט ויני עזריאלי): a leading חודש column
      //   shifts everything right and the name repeats on every row.
      const headerRowIdx = findHeaderRow(rawData);
      if (headerRowIdx < 0) {
        legacyWarnings.push(`Sheet "${workbook.SheetNames[sheetIdx]}": no שם לקוח header found, skipped`);
        continue;
      }
      const headers = rawData[headerRowIdx];
      const nameCol = findCol(headers, h => h.includes("שם לקוח"), LEGACY_FRANCHISEE_COL);
      const productCol = findCol(headers, h => h.includes("מק"), LEGACY_PRODUCT_COL);
      // The purchase-amount header mentions ש"ח (vs "סכום של כמות" = quantity)
      const amountCol = findCol(
        headers,
        h => h.includes("סכום") && /ש["'׳״]ח/.test(h),
        LEGACY_PRODUCT_AMOUNT_COL
      );
      const commissionCol = findCol(
        headers,
        h => h.includes("ניהול") && !h.includes("אחוז"),
        LEGACY_COMMISSION_AMOUNT_COL
      );

      // Aggregate product rows per franchisee. The name cell is filled either
      // only on the first row of a customer block (standard layout) or on
      // every row (new-branch layout) — carry-forward covers both, and blocks
      // of the same customer within one sheet sum together.
      const sheetTotals = new Map<string, CustomerBlock>();
      let currentName = "";

      for (let rowIdx = headerRowIdx + 1; rowIdx < rawData.length; rowIdx++) {
        const row = rawData[rowIdx];
        if (!row) continue;

        const nameCell = String(row[nameCol] || "").trim();
        if (nameCell) currentName = nameCell;

        const product = String(row[productCol] || "").trim();
        if (!product || !currentName) {
          skippedRows++;
          continue;
        }

        const block = sheetTotals.get(currentName) ?? {
          franchisee: currentName,
          totalPurchase: 0,
          totalCommission: 0,
          rowCount: 0,
          firstRow: rowIdx + 1,
        };
        // Include all values (positive and negative for returns)
        block.totalPurchase += parseNumericValue(row[amountCol]);
        block.totalCommission += parseNumericValue(row[commissionCol]);
        block.rowCount++;
        sheetTotals.set(currentName, block);
      }

      // Merge this sheet into the cross-sheet result
      for (const block of sheetTotals.values()) {
        const existing = mergedBlocks.get(block.franchisee);
        if (existing) {
          // Same totals → per-brand breakout duplicate, skip silently.
          // Different totals → keep the first sheet's numbers and warn.
          const samePurchase = roundAmount(existing.totalPurchase) === roundAmount(block.totalPurchase);
          const sameCommission = roundAmount(existing.totalCommission) === roundAmount(block.totalCommission);
          if (!samePurchase || !sameCommission) {
            warnings.push(
              createFileProcessingError("PARSE_ERROR", {
                rowNumber: block.firstRow,
                details: `"${block.franchisee}" מופיע בגיליון "${workbook.SheetNames[sheetIdx]}" עם סכומים שונים (${roundAmount(block.totalPurchase)} מול ${roundAmount(existing.totalPurchase)}) — נלקחו הסכומים מהגיליון הראשון`,
              })
            );
            legacyWarnings.push(
              `"${block.franchisee}" appears on sheet "${workbook.SheetNames[sheetIdx]}" with different totals; kept first sheet's numbers`
            );
          }
          continue;
        }
        mergedBlocks.set(block.franchisee, block);
      }
    }

    const customerBlocks = [...mergedBlocks.values()];

    if (customerBlocks.length === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Could not find any customer blocks in the file",
        })
      );
      legacyErrors.push("Could not find any customer blocks in the file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, totalRowsAllSheets);
    }

    // Convert customer blocks to ParsedRowData
    let totalNetAmount = 0;
    let totalPreCalculatedCommission = 0;
    let processedCustomers = 0;
    let rowNumber = 1;

    for (const block of customerBlocks) {
      // Skip customers with zero or negative total purchase
      if (block.totalPurchase <= 0) {
        warnings.push(
          createFileProcessingError("NEGATIVE_AMOUNT", {
            rowNumber: block.firstRow,
            details: `Customer "${block.franchisee}" has non-positive purchase amount: ${block.totalPurchase} (${block.rowCount} rows)`,
            value: String(block.totalPurchase),
          })
        );
        continue;
      }

      // Purchase amount is used for cross-reference with franchisees (assumed net without VAT)
      const netAmount = roundAmount(block.totalPurchase);
      const grossAmount = roundAmount(block.totalPurchase * 1.18);
      // Commission is pre-calculated by the supplier
      const preCalculatedCommission = roundAmount(block.totalCommission);

      data.push({
        franchisee: block.franchisee,
        date: null,
        grossAmount,
        netAmount,
        originalAmount: netAmount,
        rowNumber: rowNumber++,
        preCalculatedCommission,
      });

      totalNetAmount += netAmount;
      totalPreCalculatedCommission += preCalculatedCommission;
      processedCustomers++;
    }

    if (processedCustomers === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Could not extract any customer data from the file",
        })
      );
      legacyErrors.push("Could not extract any customer data from the file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, totalRowsAllSheets);
    }

    return createResult(
      true,
      data,
      errors,
      warnings,
      legacyErrors,
      legacyWarnings,
      totalRowsAllSheets,
      processedCustomers,
      skippedRows,
      roundAmount(totalNetAmount * 1.18),
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
      totalGrossAmount: roundAmount(totalGrossAmount),
      totalNetAmount: roundAmount(totalNetAmount),
      vatAdjusted: false,
    },
  };
}
