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

// Column indices (0-based)
const CUSTOMER_ID_COL = 0; // Column A - מס' לקוח
const FRANCHISEE_COL = 1; // Column B - שם לקוח
const PRODUCT_COL = 2; // Column C - מק'ט
const PRODUCT_AMOUNT_COL = 5; // Column F - סכום של סכום ש'ח (purchase amount for cross-reference)
const COMMISSION_AMOUNT_COL = 7; // Column H - סה"כ ניהול לפני מע"מ (pre-calculated commission)

// Row configuration
const HEADER_ROW = 0; // Row 1 (0-indexed)
const DATA_START_ROW = 1; // Row 2 (0-indexed)

// Skip keywords - rows with these values in column A should be skipped
const SKIP_KEYWORDS = ["סכום כולל", "מס' לקוח"];

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
 * Check if a row is a customer header row (has customer ID in column A)
 */
function isCustomerHeaderRow(row: unknown[]): boolean {
  const customerId = String(row[CUSTOMER_ID_COL] || "").trim();
  if (!customerId) return false;
  // Skip total row and header row
  return !SKIP_KEYWORDS.some((keyword) =>
    customerId.toLowerCase().includes(keyword.toLowerCase())
  );
}

/**
 * Check if a row has valid product data
 */
function hasProductData(row: unknown[]): boolean {
  // Check if row has a product ID (column C)
  const productId = row[PRODUCT_COL];
  return productId !== null && productId !== undefined && String(productId).trim() !== "";
}

interface CustomerBlock {
  franchisee: string;
  totalPurchase: number; // Sum of product amounts (Column F) - for cross-reference
  totalCommission: number; // Sum of commission amounts (Column H) - pre-calculated
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

      // Validate headers (first sheet only — later sheets share the layout)
      if (sheetIdx === 0) {
        const headers = rawData[HEADER_ROW] || [];
        const customerIdHeader = String(headers[CUSTOMER_ID_COL] || "");
        const franchiseeHeader = String(headers[FRANCHISEE_COL] || "");
        const commissionHeader = String(headers[COMMISSION_AMOUNT_COL] || "");

        if (!customerIdHeader.includes("לקוח")) {
          warnings.push(
            createFileProcessingError("PARSE_ERROR", {
              details: `Expected customer ID column header at A, found: "${customerIdHeader}"`,
            })
          );
        }
        if (!franchiseeHeader.includes("לקוח")) {
          warnings.push(
            createFileProcessingError("PARSE_ERROR", {
              details: `Expected franchisee column header at B, found: "${franchiseeHeader}"`,
            })
          );
        }
        if (!commissionHeader.includes("ניהול") && !commissionHeader.includes("מע")) {
          warnings.push(
            createFileProcessingError("PARSE_ERROR", {
              details: `Expected commission column header at H, found: "${commissionHeader}"`,
            })
          );
        }
      }

      // Find all customer block start rows in this sheet
      const customerStartRows: number[] = [];
      for (let rowIdx = DATA_START_ROW; rowIdx < rawData.length; rowIdx++) {
        const row = rawData[rowIdx];
        if (row && isCustomerHeaderRow(row)) {
          customerStartRows.push(rowIdx);
        }
      }
      if (customerStartRows.length === 0) continue;

      // Find the last row with product data
      let lastDataRow = DATA_START_ROW;
      for (let rowIdx = rawData.length - 1; rowIdx >= DATA_START_ROW; rowIdx--) {
        const row = rawData[rowIdx];
        if (row && hasProductData(row)) {
          lastDataRow = rowIdx;
          break;
        }
      }

      // Add end boundary for last customer
      customerStartRows.push(lastDataRow + 1);

      // Process each customer block in this sheet
      for (let i = 0; i < customerStartRows.length - 1; i++) {
        const startRow = customerStartRows[i];
        const endRow = customerStartRows[i + 1];
        const headerRow = rawData[startRow];

        if (!headerRow) {
          skippedRows++;
          continue;
        }

        const franchisee = String(headerRow[FRANCHISEE_COL] || "").trim();
        if (!franchisee) {
          warnings.push(
            createFileProcessingError("EMPTY_FRANCHISEE_NAME", {
              rowNumber: startRow + 1,
            })
          );
          legacyWarnings.push(`Row ${startRow + 1}: Empty franchisee name`);
          skippedRows++;
          continue;
        }

        // Sum purchase and commission amounts for all product rows in this customer block
        let totalPurchase = 0;
        let totalCommission = 0;
        let rowCount = 0;

        for (let rowIdx = startRow; rowIdx < endRow; rowIdx++) {
          const row = rawData[rowIdx];
          if (!row || !hasProductData(row)) {
            continue;
          }

          const purchase = parseNumericValue(row[PRODUCT_AMOUNT_COL]);
          const commission = parseNumericValue(row[COMMISSION_AMOUNT_COL]);
          // Include all values (positive and negative for returns)
          totalPurchase += purchase;
          totalCommission += commission;
          rowCount++;
        }

        if (rowCount === 0) {
          warnings.push(
            createFileProcessingError("PARSE_ERROR", {
              rowNumber: startRow + 1,
              details: `Customer "${franchisee}" has no product rows`,
            })
          );
          skippedRows++;
          continue;
        }

        const existing = mergedBlocks.get(franchisee);
        if (existing) {
          // Same totals → per-brand breakout duplicate, skip silently.
          // Different totals → keep the first sheet's numbers and warn.
          const samePurchase = roundAmount(existing.totalPurchase) === roundAmount(totalPurchase);
          const sameCommission = roundAmount(existing.totalCommission) === roundAmount(totalCommission);
          if (!samePurchase || !sameCommission) {
            warnings.push(
              createFileProcessingError("PARSE_ERROR", {
                rowNumber: startRow + 1,
                details: `"${franchisee}" מופיע בגיליון "${workbook.SheetNames[sheetIdx]}" עם סכומים שונים (${roundAmount(totalPurchase)} מול ${roundAmount(existing.totalPurchase)}) — נלקחו הסכומים מהגיליון הראשון`,
              })
            );
            legacyWarnings.push(
              `"${franchisee}" appears on sheet "${workbook.SheetNames[sheetIdx]}" with different totals; kept first sheet's numbers`
            );
          }
          continue;
        }

        mergedBlocks.set(franchisee, {
          franchisee,
          totalPurchase,
          totalCommission,
          rowCount,
          firstRow: startRow + 1,
        });
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
