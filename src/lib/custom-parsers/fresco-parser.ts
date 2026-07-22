/**
 * Custom parser for פרסקו (FRESCO) supplier files
 *
 * Two layouts are auto-detected:
 *
 * 1. BLOCK layout (current, since Q2-2026) — one sheet per brand plus a "סיכום"
 *    brand-level summary sheet. Each brand sheet holds a block per franchisee:
 *      <franchisee name>
 *      תאריך | מס' חשבונית | סכום (ש"ח)     <- header row, anchors the columns
 *      <invoice rows...>
 *      סה"כ <franchisee name> | <total>
 *    and ends with a "סה"כ כללי רשת X" row. Blocks are located by the header
 *    row, never by fixed row/column indices — the supplier reshuffles geometry.
 *
 * 2. LEGACY pivot layout — a "גיליון2" sheet with row labels in col A and the
 *    summed amount in col B. Kept so historical quarters can be reprocessed.
 *
 * Amounts in both layouts are NET (before VAT); gross = net * (1 + vatRate).
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundAmount,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

const DEFAULT_VAT_RATE = 0.18;

/** Tolerance (₪) when comparing our sums against the file's own total rows */
const TOTAL_TOLERANCE = 1;

// Legacy pivot column indices
const LEGACY_FRANCHISEE_COL = 0;
const LEGACY_AMOUNT_COL = 1;

type Row = unknown[];

/** Parse a cell into a number. Returns null when it isn't numeric. */
function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return isNaN(value) ? null : value;
  if (value instanceof Date) return null;

  const cleaned = String(value)
    .replace(/[₪$€£¥,\s]/g, "")
    .replace(/^\((.*)\)$/, "-$1")
    .trim();
  if (!cleaned) return null;

  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

/** Excel serial for 1970-01-01 */
const EXCEL_EPOCH_OFFSET = 25569;

/**
 * Excel serial → local Date at midnight.
 *
 * We deliberately do NOT read the workbook with cellDates:true — it yields
 * Dates shifted by the runtime timezone (serial 46141 → Apr 28 20:59 UTC
 * instead of Apr 29). Note `XLSX.SSF` is undefined under this project's
 * `import * as XLSX` interop, so the serial is converted by hand.
 */
function toDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value !== "number" || !Number.isFinite(value) || value <= 0) return null;

  const utc = new Date(Math.round((value - EXCEL_EPOCH_OFFSET) * 86_400_000));
  if (Number.isNaN(utc.getTime())) return null;
  // Rebuild in local time so the calendar day can't drift (see CLAUDE.md).
  return new Date(utc.getUTCFullYear(), utc.getUTCMonth(), utc.getUTCDate());
}

function cellText(value: unknown): string {
  if (value === null || value === undefined) return "";
  if (value instanceof Date) return "";
  return String(value).trim();
}

/** A totals row — block total, sheet grand total, or the legacy "סכום כולל" */
function isTotalText(text: string): boolean {
  return /^סה["'״]?\s*כ/.test(text) || text.startsWith("סכום כולל");
}

interface HeaderCols {
  dateCol: number;
  invoiceCol: number;
  amountCol: number;
}

/**
 * Detect the block header row (תאריך / מס' חשבונית / סכום) and read the
 * column positions off it.
 */
function readHeader(row: Row): HeaderCols | null {
  let dateCol = -1;
  let invoiceCol = -1;
  let amountCol = -1;

  row.forEach((cell, idx) => {
    const text = cellText(cell);
    if (dateCol < 0 && text.includes("תאריך")) dateCol = idx;
    else if (invoiceCol < 0 && text.includes("חשבונית")) invoiceCol = idx;
    else if (amountCol < 0 && text.includes("סכום")) amountCol = idx;
  });

  if (dateCol < 0 || invoiceCol < 0 || amountCol < 0) return null;
  return { dateCol, invoiceCol, amountCol };
}

interface Block {
  franchisee: string;
  netAmount: number;
  earliestDate: Date | null;
  invoiceCount: number;
}

interface BlockScan {
  blocks: Block[];
  warnings: string[];
  totalRows: number;
  skippedRows: number;
}

/**
 * Scan every sheet for franchisee blocks. Sheets without a block header
 * (e.g. the "סיכום" brand summary) contribute nothing.
 */
function scanBlockLayout(workbook: XLSX.WorkBook): BlockScan {
  const blocks = new Map<string, Block>();
  const warnings: string[] = [];
  let totalRows = 0;
  let skippedRows = 0;

  for (const sheetName of workbook.SheetNames) {
    // raw:true keeps dates as Date and amounts as number — no ambiguous
    // "4/29/26" string parsing, no "2,001.69 ₪" stripping.
    const rows: Row[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: true,
      defval: null,
    });
    totalRows += rows.length;

    let sheetSum = 0;
    let sheetGrandTotal: number | null = null;
    let foundBlockInSheet = false;

    for (let i = 0; i < rows.length; i++) {
      const header = readHeader(rows[i]);
      if (!header) {
        // Remember the sheet's own grand total row for the sanity check below
        const row = rows[i] ?? [];
        const label = row.map(cellText).find((t) => isTotalText(t) && t.includes("כללי"));
        if (label) {
          const numbers = row.map(toNumber).filter((n): n is number => n !== null);
          sheetGrandTotal = numbers.length > 0 ? numbers[numbers.length - 1] : null;
        }
        skippedRows++;
        continue;
      }

      foundBlockInSheet = true;
      const { dateCol, invoiceCol, amountCol } = header;

      // Franchisee name: nearest non-empty text row above the header
      let franchisee = "";
      for (let back = i - 1; back >= 0; back--) {
        const candidate = cellText(rows[back]?.[0]);
        if (candidate) {
          franchisee = candidate;
          break;
        }
      }
      if (!franchisee) {
        warnings.push(
          `גיליון "${sheetName}": נמצאה טבלה בשורה ${i + 1} ללא שם זכיין מעליה — דולגה`
        );
        skippedRows++;
        continue;
      }

      // Data rows until the block total / a blank row / the next header
      let netAmount = 0;
      let invoiceCount = 0;
      let earliestDate: Date | null = null;
      let declaredTotal: number | null = null;
      let r = i + 1;

      for (; r < rows.length; r++) {
        const row = rows[r];
        const invoiceText = cellText(row?.[invoiceCol]);

        if (isTotalText(invoiceText)) {
          declaredTotal = toNumber(row?.[amountCol]);
          break;
        }

        const amount = toNumber(row?.[amountCol]);
        if (amount === null) break; // blank row or start of the next section

        // Negative amounts are credit notes — they count.
        netAmount += amount;
        invoiceCount++;

        const rowDate = toDate(row?.[dateCol]);
        if (rowDate && (!earliestDate || rowDate < earliestDate)) {
          earliestDate = rowDate;
        }
      }

      skippedRows += 1; // the header row itself

      if (invoiceCount === 0) {
        warnings.push(`גיליון "${sheetName}": הבלוק של "${franchisee}" ריק`);
        i = r;
        continue;
      }

      netAmount = roundAmount(netAmount);

      if (
        declaredTotal !== null &&
        Math.abs(roundAmount(declaredTotal) - netAmount) > TOTAL_TOLERANCE
      ) {
        warnings.push(
          `פער בבלוק "${franchisee}": סכום השורות ${netAmount.toLocaleString("he-IL")} ` +
            `מול "סה"כ" בקובץ ${roundAmount(declaredTotal).toLocaleString("he-IL")}`
        );
      }

      const existing = blocks.get(franchisee);
      if (existing) {
        existing.netAmount = roundAmount(existing.netAmount + netAmount);
        existing.invoiceCount += invoiceCount;
        if (earliestDate && (!existing.earliestDate || earliestDate < existing.earliestDate)) {
          existing.earliestDate = earliestDate;
        }
      } else {
        blocks.set(franchisee, { franchisee, netAmount, earliestDate, invoiceCount });
      }

      sheetSum = roundAmount(sheetSum + netAmount);
      i = r; // continue after the block total row
    }

    // Sheet-level sanity check: a block missed because of a future layout
    // change shows up here instead of passing silently.
    if (
      foundBlockInSheet &&
      sheetGrandTotal !== null &&
      Math.abs(roundAmount(sheetGrandTotal) - sheetSum) > TOTAL_TOLERANCE
    ) {
      warnings.push(
        `גיליון "${sheetName}": סכום הבלוקים ${sheetSum.toLocaleString("he-IL")} ` +
          `אינו תואם ל"סה"כ כללי" בקובץ ${roundAmount(sheetGrandTotal).toLocaleString("he-IL")}`
      );
    }
  }

  return { blocks: [...blocks.values()], warnings, totalRows, skippedRows };
}

/** Legacy "גיליון2" pivot: row label in col A, summed amount in col B */
function scanLegacyPivot(workbook: XLSX.WorkBook): BlockScan {
  const sheetName = workbook.SheetNames.find(
    (name) => name.includes("גיליון2") || name.includes("גליון2")
  );
  if (!sheetName) {
    return { blocks: [], warnings: [], totalRows: 0, skippedRows: 0 };
  }

  const rows: Row[] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
    header: 1,
    raw: true,
    defval: null,
  });

  const blocks: Block[] = [];
  let skippedRows = 0;

  for (let i = 1; i < rows.length; i++) {
    const franchisee = cellText(rows[i]?.[LEGACY_FRANCHISEE_COL]);
    const amount = toNumber(rows[i]?.[LEGACY_AMOUNT_COL]);

    if (!franchisee || amount === null || amount === 0 || isTotalText(franchisee)) {
      skippedRows++;
      continue;
    }

    blocks.push({
      franchisee,
      netAmount: roundAmount(amount),
      earliestDate: null,
      invoiceCount: 1,
    });
  }

  return { blocks, warnings: [], totalRows: rows.length, skippedRows };
}

/**
 * Parse a פרסקו supplier file. Tries the current block layout first, then the
 * legacy גיליון2 pivot.
 */
export function parseFrescoFile(
  buffer: Buffer,
  vatRate: number = DEFAULT_VAT_RATE
): FileProcessingResult {
  const errors: import("../file-processing-errors").FileProcessingError[] = [];
  const warnings: import("../file-processing-errors").FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];

  try {
    // No cellDates — see toDate() above.
    const workbook = XLSX.read(buffer, { type: "buffer" });

    if (workbook.SheetNames.length === 0) {
      errors.push(createFileProcessingError("NO_WORKSHEETS"));
      legacyErrors.push("No worksheets found in file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    let scan = scanBlockLayout(workbook);
    if (scan.blocks.length === 0) {
      const legacy = scanLegacyPivot(workbook);
      if (legacy.blocks.length > 0) {
        scan = legacy;
        legacyWarnings.push("הקובץ במבנה הישן (גיליון2) — נקלט דרך ה-fallback");
        warnings.push(
          createFileProcessingError("PARSE_ERROR", {
            details: "Legacy גיליון2 pivot layout detected",
          })
        );
      }
    }

    for (const warning of scan.warnings) {
      legacyWarnings.push(warning);
      warnings.push(createFileProcessingError("PARSE_ERROR", { details: warning }));
    }

    if (scan.blocks.length === 0) {
      const details =
        'לא נמצאו טבלאות במבנה "תאריך / מס\' חשבונית / סכום" ואף לא גיליון pivot בשם "גיליון2" — ' +
        "ייתכן שפרסקו שינו שוב את פורמט הייצוא";
      errors.push(createFileProcessingError("PARSE_ERROR", { details }));
      legacyErrors.push(details);
      return createResult(
        false,
        data,
        errors,
        warnings,
        legacyErrors,
        legacyWarnings,
        scan.totalRows
      );
    }

    let totalNetAmount = 0;
    let totalGrossAmount = 0;
    let rowNumber = 1;

    for (const block of scan.blocks) {
      const netAmount = roundAmount(block.netAmount);
      const grossAmount = roundAmount(netAmount * (1 + vatRate));

      data.push({
        franchisee: block.franchisee,
        date: block.earliestDate,
        grossAmount,
        netAmount,
        originalAmount: netAmount,
        rowNumber: rowNumber++,
      });

      totalNetAmount += netAmount;
      totalGrossAmount += grossAmount;
    }

    return createResult(
      true,
      data,
      errors,
      warnings,
      legacyErrors,
      legacyWarnings,
      scan.totalRows,
      data.length,
      scan.skippedRows,
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
