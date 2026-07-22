/**
 * Custom parser for מחלבות גד (MACHLAVOT_GAD) supplier files
 *
 * The supplier sends a pivot-table export whose geometry changes between
 * periods (H2-2025: tables stacked in cols 4-7; H1-2026: cross-ref table in
 * cols 0-2 plus THREE per-brand commission tables in cols 5-8 and 10-13).
 * Columns/positions are therefore located by HEADER TEXT, not fixed indices:
 *
 *   - A title cell containing "כולל ניגרת" (without "לא") anchors the
 *     CROSS-REFERENCE table: franchisee names under the title column,
 *     amounts under the "*סכום" header on the next row. → netAmount
 *   - Each title cell containing "לא כולל ניגרת" anchors a COMMISSION-BASE
 *     table: franchisee names under the "לקוח" header, per-product rows
 *     under the title column, amounts under "*סכום". Product rows are summed
 *     per franchisee (franchisee-subtotal rows have an empty product cell and
 *     are skipped to avoid double counting). → 9% commission basis
 *
 * Every table ends at its "Grand Total" row.
 *
 * Output per franchisee:
 *   - netAmount   = כולל ניגרת amount (cross-reference vs franchisee reports)
 *   - grossAmount = netAmount × (1 + VAT)
 *   - preCalculatedCommission = 9% × לא כולל ניגרת amount (fallback: netAmount)
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundAmount,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

// VAT rate in Israel
const VAT_RATE = 0.18;

// Commission rate for מחלבות גד
const COMMISSION_RATE = 0.09;

const GRAND_TOTAL = "Grand Total";

type TableAnchor = {
  row: number;
  col: number;
  isCommissionBase: boolean;
};

/** Find every table title cell containing "ניגרת" */
function findAnchors(rawData: unknown[][]): TableAnchor[] {
  const anchors: TableAnchor[] = [];
  for (let r = 0; r < rawData.length; r++) {
    const row = rawData[r];
    if (!row) continue;
    for (let c = 0; c < row.length; c++) {
      const cell = String(row[c] || "");
      if (!cell.includes("ניגרת") || !cell.includes("קניות")) continue;
      anchors.push({
        row: r,
        col: c,
        isCommissionBase: cell.includes("לא כולל ניגרת"),
      });
    }
  }
  return anchors;
}

/** Locate the amount column: the "סכום" header on the row below the title */
function findAmountCol(rawData: unknown[][], anchor: TableAnchor): number {
  const headerRow = rawData[anchor.row + 1] || [];
  for (let c = Math.max(0, anchor.col - 2); c <= anchor.col + 4; c++) {
    if (String(headerRow[c] || "").includes("סכום")) return c;
  }
  return -1;
}

/** Locate the franchisee-name column: a cell equal to "לקוח" on the title row */
function findNameCol(rawData: unknown[][], anchor: TableAnchor): number {
  const titleRow = rawData[anchor.row] || [];
  for (let c = Math.max(0, anchor.col - 3); c <= anchor.col + 3; c++) {
    if (String(titleRow[c] || "").trim() === "לקוח") return c;
  }
  // Cross-reference table has no "לקוח" header — names sit under the title
  return anchor.col;
}

function parseAmount(value: unknown): number {
  const num = parseFloat(String(value || "").replace(/[,\s]/g, ""));
  return isNaN(num) ? 0 : num;
}

/**
 * Parse מחלבות גד supplier file — header-anchored multi-table pivot layout
 */
export function parseMachlavotGadFile(buffer: Buffer): FileProcessingResult {
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

    const anchors = findAnchors(rawData);
    const crossRefAnchors = anchors.filter(a => !a.isCommissionBase);
    const baseAnchors = anchors.filter(a => a.isCommissionBase);

    if (crossRefAnchors.length === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: 'לא נמצאה טבלת "כולל ניגרת" בקובץ — ייתכן שמבנה הקובץ השתנה שוב',
        })
      );
      legacyErrors.push('Could not find the "כולל ניגרת" (cross-reference) table');
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rawData.length);
    }

    // netAmount per franchisee (כולל ניגרת — for cross-reference)
    const crossRefAmounts: Map<string, number> = new Map();
    // commission basis per franchisee (לא כולל ניגרת, summed across brand tables)
    const baseAmounts: Map<string, number> = new Map();

    for (const anchor of anchors) {
      const amountCol = findAmountCol(rawData, anchor);
      const nameCol = findNameCol(rawData, anchor);
      if (amountCol < 0) {
        legacyWarnings.push(`Skipping table at row ${anchor.row + 1}: no סכום column found`);
        continue;
      }
      // Commission-base tables carry per-product rows under the title column
      const productCol = anchor.isCommissionBase ? anchor.col : -1;
      const target = anchor.isCommissionBase ? baseAmounts : crossRefAmounts;

      for (let r = anchor.row + 2; r < rawData.length; r++) {
        const row = rawData[r];
        if (!row) continue;

        const nameNeighbor = String(row[nameCol - 1] || "").trim();
        const name = String(row[nameCol] || "").trim();
        if (name === GRAND_TOTAL || nameNeighbor === GRAND_TOTAL) break;
        if (!name) continue;

        // In base tables, franchisee-subtotal rows have an empty product cell —
        // skip them; the per-product rows already sum to the subtotal.
        if (productCol >= 0 && !String(row[productCol] || "").trim()) continue;

        const amount = parseAmount(row[amountCol]);
        if (amount === 0) continue;

        target.set(name, (target.get(name) || 0) + amount);
      }
    }

    // Merge: netAmount from cross-ref table, commission from base tables
    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let rowNumber = 1;

    for (const [franchisee, baseOnly] of baseAmounts) {
      if (!crossRefAmounts.has(franchisee)) {
        warnings.push(
          createFileProcessingError("PARSE_ERROR", {
            details: `Franchisee "${franchisee}" (${baseOnly}) found only in לא כולל ניגרת tables, skipping.`,
          })
        );
        legacyWarnings.push(`Franchisee "${franchisee}" found only in commission-base tables, skipping.`);
      }
    }

    for (const [franchisee, crossRefAmount] of crossRefAmounts) {
      const netAmount = roundAmount(crossRefAmount);
      if (netAmount <= 0) continue;

      const grossAmount = roundAmount(netAmount * (1 + VAT_RATE));
      const commissionBasis = baseAmounts.get(franchisee) ?? crossRefAmount;
      const preCalculatedCommission = roundAmount(commissionBasis * COMMISSION_RATE);

      data.push({
        franchisee,
        date: null,
        grossAmount,
        netAmount,
        originalAmount: netAmount,
        rowNumber: rowNumber++,
        preCalculatedCommission,
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
      totalGrossAmount: roundAmount(totalGrossAmount),
      totalNetAmount: roundAmount(totalNetAmount),
      vatAdjusted: false,
    },
  };
}
