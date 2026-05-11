/**
 * Custom parser for ימה וקדמה (YAMA_VEKADMA) supplier files
 *
 * File structure (Sheilta per-customer ledger export, format updated May 2026):
 *   The file contains one block per franchisee. Each block looks like:
 *
 *     row N+0:  Title row — "ימה וקדמה י.א. בע"מ (1) // שנת 2026"
 *     row N+1:  "ספר לחשבון:<FRANCHISEE_NAME> ( <CUSTOMER_ID>)"
 *     row N+2:  "מועד הדפסה:DD/MM/YYYY HH:MM:SS"
 *     row N+3,N+4: blank
 *     row N+5:  Header — "תאריך מסמך","סוג","מסמך","ש.","תאריך פרעון",
 *                        "ח-ן נגדי","אסמכתא","פרטים","סכומים בשקלים"
 *     row N+6:  Sub-header — null × 8, "חובה","זכות","יתרה"
 *     row N+7+: Data rows (col 0 = M/D/YY date)
 *     row N+k:  Subtotal — col 7 = "סהכ"
 *
 *   File ends with a commission summary line:
 *     "סהכל 12% מתוך 6,719.33 = 806.3"
 *
 * Amount semantics:
 *   - Amounts include VAT (supplier config has vatIncluded=true).
 *   - Per transaction: amount = debit (col 8) − credit (col 9).
 *     Credit memos (doc type 651) usually appear as a negative debit; netting
 *     against the credit column covers the rare case where it's split.
 *
 * Output:
 *   - One ParsedRowData per franchisee with aggregated gross/net amounts.
 *   - `date` = latest document date in that franchisee's block (used downstream
 *     to verify the admin-selected settlement period).
 *   - Validation warning if sum across franchisees doesn't match the file's
 *     own footer total (tolerance ≤ 1 ₪).
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundAmount,
} from "../file-processor";
import {
  type FileProcessingError,
  createFileProcessingError,
} from "../file-processing-errors";

// Column indices (0-based) within data rows
const DATE_COL = 0; // תאריך מסמך
const DEBIT_COL = 8; // חובה
const CREDIT_COL = 9; // זכות
const SUBTOTAL_LABEL_COL = 7; // "סהכ" appears in col 7 on subtotal rows

// VAT rate in Israel — amounts in this file include VAT
const VAT_RATE = 0.18;

// "ספר לחשבון:<name> ( <customer_id>)"
const FRANCHISEE_ROW_RE =
  /^ספר\s+לחשבון\s*:\s*(.+?)\s*\(\s*\d+\s*\)\s*$/;

// Data row date format: M/D/YY (US locale — Sheilta export)
const DATE_RE = /^(\d{1,2})\/(\d{1,2})\/(\d{2,4})$/;

// Footer line: "סהכל 12% מתוך 6,719.33 = 806.3"
const FOOTER_TOTAL_RE =
  /^סהכל\s+\d+(?:\.\d+)?\s*%\s*מתוך\s+([\d,]+(?:\.\d+)?)\s*=/;

// Subtotal labels that may appear in col 7
const SUBTOTAL_LABELS = ["סהכ", 'סה"כ', "סך הכל"];

interface FranchiseeAccumulator {
  name: string;
  totalAmount: number;
  latestDate: Date | null;
  txCount: number;
  firstRow: number;
}

/**
 * Parse a numeric value from a cell. Handles currency symbols, thousands
 * separators, parentheses-as-negative, and stray whitespace.
 */
function parseNumericValue(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return Number.isNaN(value) ? 0 : value;

  let s = String(value).trim();
  s = s.replace(/[₪$€£¥]/g, "").replace(/,/g, "").replace(/\s/g, "").trim();

  if (s.startsWith("(") && s.endsWith(")")) {
    s = "-" + s.slice(1, -1);
  }

  if (s === "" || s === "-") return 0;

  const n = parseFloat(s);
  return Number.isNaN(n) ? 0 : n;
}

/**
 * Parse a Sheilta-format date string (M/D/YY or M/D/YYYY) into a local Date.
 * Returns null on parse failure. Local TZ avoids the UTC-shift bug documented
 * in CLAUDE.md (toISOString shifts Israel dates by one day).
 */
function parseMDY(value: unknown): Date | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  const m = s.match(DATE_RE);
  if (!m) return null;

  const month = parseInt(m[1], 10);
  const day = parseInt(m[2], 10);
  let year = parseInt(m[3], 10);
  if (year < 100) year += 2000;

  if (month < 1 || month > 12 || day < 1 || day > 31) return null;

  const d = new Date(year, month - 1, day);
  if (Number.isNaN(d.getTime())) return null;
  return d;
}

function isSubtotalRow(row: unknown[]): boolean {
  const label = String(row[SUBTOTAL_LABEL_COL] ?? "").trim();
  return SUBTOTAL_LABELS.some((l) => label.includes(l));
}

export function parseYamaVekadmaFile(buffer: Buffer): FileProcessingResult {
  const errors: FileProcessingError[] = [];
  const warnings: FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];

  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: false });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      errors.push(createFileProcessingError("NO_WORKSHEETS"));
      legacyErrors.push("No worksheets found in file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    const rawData: unknown[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
    });

    if (!rawData || rawData.length < 2) {
      errors.push(createFileProcessingError("FILE_EMPTY"));
      legacyErrors.push("File is empty or too short");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    const franchisees: FranchiseeAccumulator[] = [];
    let current: FranchiseeAccumulator | null = null;
    let fileTotalGross: number | null = null;

    for (let rowIdx = 0; rowIdx < rawData.length; rowIdx++) {
      const row = rawData[rowIdx] ?? [];
      const firstCell = String(row[0] ?? "").trim();

      if (!firstCell && row.every((c) => c === "" || c === null || c === undefined)) {
        continue;
      }

      const franchiseeMatch = firstCell.match(FRANCHISEE_ROW_RE);
      if (franchiseeMatch) {
        if (current) franchisees.push(current);
        current = {
          name: franchiseeMatch[1].trim(),
          totalAmount: 0,
          latestDate: null,
          txCount: 0,
          firstRow: rowIdx + 1,
        };
        continue;
      }

      const footerMatch = firstCell.match(FOOTER_TOTAL_RE);
      if (footerMatch) {
        fileTotalGross = parseNumericValue(footerMatch[1]);
        continue;
      }

      if (isSubtotalRow(row)) continue;

      if (current) {
        const txDate = parseMDY(row[DATE_COL]);
        if (!txDate) continue;

        const debit = parseNumericValue(row[DEBIT_COL]);
        const credit = parseNumericValue(row[CREDIT_COL]);
        const txAmount = debit - credit;

        current.totalAmount += txAmount;
        current.txCount++;
        if (!current.latestDate || txDate > current.latestDate) {
          current.latestDate = txDate;
        }
      }
    }

    if (current) franchisees.push(current);

    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let skippedRows = 0;
    let rowNumber = 1;

    for (const f of franchisees) {
      if (f.totalAmount === 0) {
        skippedRows++;
        continue;
      }

      if (f.totalAmount < 0) {
        warnings.push(
          createFileProcessingError("NEGATIVE_AMOUNT", {
            rowNumber: f.firstRow,
            details: `זכיין "${f.name}" עם סכום שלילי: ${f.totalAmount}`,
            value: String(f.totalAmount),
          })
        );
      }

      const grossAmount = roundAmount(f.totalAmount);
      const netAmount = roundAmount(grossAmount / (1 + VAT_RATE));

      data.push({
        franchisee: f.name,
        date: f.latestDate,
        grossAmount,
        netAmount,
        originalAmount: grossAmount,
        rowNumber: rowNumber++,
      });

      totalGrossAmount += grossAmount;
      totalNetAmount += netAmount;
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

    if (fileTotalGross !== null) {
      const delta = Math.abs(roundAmount(totalGrossAmount) - roundAmount(fileTotalGross));
      if (delta > 1) {
        warnings.push(
          createFileProcessingError("PARSE_ERROR", {
            details: `סך הסכום המחושב מהזכיינים (${roundAmount(totalGrossAmount)}) אינו תואם לסיכום שבקובץ (${roundAmount(fileTotalGross)})`,
            value: String(delta),
          })
        );
      }
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
  errors: FileProcessingError[],
  warnings: FileProcessingError[],
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
      vatAdjusted: true,
    },
  };
}
