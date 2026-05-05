/**
 * Custom parser for יבולי גורמה (YEVULEI_GOURMET) supplier files.
 *
 * Source: monthly sales report exported from a Hebrew accounting system,
 *         sheet name starts with "דוח מכירות".
 *
 * Layout (one or more customer sections per sheet):
 *
 *   <metadata rows>            (date, page, year "לשנת : YYYY", customer range, ...)
 *   <customer header>          col rightmost: "<franchisee name>  <customer code>"
 *   <month header row>         col 0 = "סה\"כ", cols 1..N = month names in RTL
 *                              (col 1 = דצמבר, col 13 = ינואר), with possible nulls
 *   <data row(s)>              col 0 = total, monthly columns hold month amounts
 *   <subtotal row>             col 0 = total, col 15 = "<name> <code>",
 *                              col 16 = ":סה\"כ"
 *
 *   ... repeated for additional customers ...
 *
 *   <grand total row>          col 0 = total of report, col 16 = ":סה\"כ לדוח"
 *                              (skipped)
 *
 * Customer cells include a trailing supplier-internal customer code
 * (e.g. "ויני חדרה מול החוף בע\"מ  1238") that is not part of the
 * franchisee aliases — strip it before downstream alias matching.
 *
 * Commission setup (DB): commission_type=percentage, default 10%, vat_exempt=true.
 * vat_exempt post-processing in file-processor.ts will set gross = net for us;
 * this parser still emits gross = net so totals are consistent if the supplier
 * is later flipped to vat_included.
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

const SHEET_PREFIX = "דוח מכירות";

// Month names in Hebrew, indexed 0..11 (Jan..Dec).
const HEBREW_MONTHS: readonly string[] = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

const TRAILING_CUSTOMER_CODE_RE = /\s+\d{3,}\s*$/;
const YEAR_RE = /לשנת\s*[:־-]\s*(\d{4})/;

// Quote-insensitive match for "סה"כ" with optional leading/trailing colon.
const SUBTOTAL_RE = /^[:\s]*סה[״"׳']?כ[:\s]*$/;
const GRAND_TOTAL_RE = /^[:\s]*סה[״"׳']?כ\s+לדוח[:\s]*$/;

interface MonthColumnMap {
  // Map of sheet column index -> calendar month index (0=Jan, 11=Dec).
  byCol: Map<number, number>;
}

interface ParsedSection {
  franchisee: string;
  total: number;
  date: Date | null;
}

export function parseYevuleiGourmetFile(
  buffer: Buffer,
  _vatRate?: number
): FileProcessingResult {
  const errors: FileProcessingError[] = [];
  const warnings: FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];

  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

    const sheetName =
      workbook.SheetNames.find((n) => n.startsWith(SHEET_PREFIX)) ??
      workbook.SheetNames[0];

    if (!sheetName) {
      errors.push(createFileProcessingError("NO_WORKSHEETS"));
      legacyErrors.push("No worksheets found");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      errors.push(
        createFileProcessingError("NO_WORKSHEETS", {
          details: `Sheet "${sheetName}" not found`,
        })
      );
      legacyErrors.push(`Sheet "${sheetName}" not found`);
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: null,
      blankrows: true,
    });

    if (rows.length === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Sheet is empty",
        })
      );
      legacyErrors.push("Sheet is empty");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    const reportYear = findReportYear(rows) ?? new Date().getFullYear();
    const monthMap = findMonthHeader(rows);

    const sections: ParsedSection[] = [];

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      if (!isPerCustomerSubtotal(row)) continue;

      const total = firstNumber(row);
      if (total === null || total === 0) continue;

      const franchiseeRaw = pickFranchiseeName(row);
      if (!franchiseeRaw) {
        warnings.push(
          createFileProcessingError("PARSE_ERROR", {
            details: `Subtotal row ${i + 1}: could not extract franchisee name`,
          })
        );
        legacyWarnings.push(
          `Subtotal row ${i + 1}: could not extract franchisee name`
        );
        continue;
      }

      const franchisee = stripCustomerCode(franchiseeRaw);
      const date = monthMap
        ? inferLatestMonthDate(rows, i, monthMap, reportYear)
        : null;

      sections.push({ franchisee, total, date });
    }

    if (sections.length === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details:
            "No customer subtotal rows found. Expected rows with cell text \":סה\\\"כ\".",
        })
      );
      legacyErrors.push("No customer subtotal rows found");
      return createResult(
        false,
        data,
        errors,
        warnings,
        legacyErrors,
        legacyWarnings,
        rows.length
      );
    }

    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let rowNumber = 0;

    for (const s of sections) {
      const netAmount = roundAmount(s.total);
      // No VAT applied — supplier is vat_exempt. file-processor will collapse
      // gross to net via post-processing, but emitting net=gross keeps the
      // result consistent if vat_exempt is ever flipped off.
      const grossAmount = netAmount;

      data.push({
        franchisee: s.franchisee,
        date: s.date,
        grossAmount,
        netAmount,
        originalAmount: netAmount,
        rowNumber: ++rowNumber,
      });

      totalGrossAmount += grossAmount;
      totalNetAmount += netAmount;
    }

    return createResult(
      true,
      data,
      errors,
      warnings,
      legacyErrors,
      legacyWarnings,
      rows.length,
      data.length,
      0,
      totalGrossAmount,
      totalNetAmount
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    errors.push(createFileProcessingError("SYSTEM_ERROR", { details: message }));
    legacyErrors.push(message);
    return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
  }
}

// ============================================================================
// Helpers
// ============================================================================

function findReportYear(rows: unknown[][]): number | null {
  for (const row of rows) {
    if (!row) continue;
    for (const cell of row) {
      if (cell === null || cell === undefined) continue;
      const m = String(cell).match(YEAR_RE);
      if (m) return parseInt(m[1], 10);
    }
  }
  return null;
}

function findMonthHeader(rows: unknown[][]): MonthColumnMap | null {
  for (const row of rows) {
    if (!row) continue;
    const byCol = new Map<number, number>();
    for (let c = 0; c < row.length; c++) {
      const text = stringOrNull(row[c]);
      if (!text) continue;
      const idx = HEBREW_MONTHS.indexOf(text);
      if (idx >= 0) byCol.set(c, idx);
    }
    // We need a strong signal — at least 3 month names — to avoid
    // misidentifying random rows containing a single Hebrew month token.
    if (byCol.size >= 3) return { byCol };
  }
  return null;
}

function isPerCustomerSubtotal(row: unknown[]): boolean {
  let hasSubtotal = false;
  for (const cell of row) {
    const text = stringOrNull(cell);
    if (!text) continue;
    if (GRAND_TOTAL_RE.test(text)) return false;
    if (SUBTOTAL_RE.test(text)) hasSubtotal = true;
  }
  return hasSubtotal;
}

function firstNumber(row: unknown[]): number | null {
  for (const cell of row) {
    if (cell === null || cell === undefined) continue;
    if (typeof cell === "number" && Number.isFinite(cell)) return cell;
    if (typeof cell === "string") {
      const cleaned = cell.replace(/[,₪\s]/g, "");
      const n = Number.parseFloat(cleaned);
      if (Number.isFinite(n) && cleaned !== "") return n;
    }
  }
  return null;
}

function pickFranchiseeName(row: unknown[]): string | null {
  // Prefer the longest text cell that isn't the subtotal marker.
  let best: string | null = null;
  for (const cell of row) {
    const text = stringOrNull(cell);
    if (!text) continue;
    if (SUBTOTAL_RE.test(text) || GRAND_TOTAL_RE.test(text)) continue;
    // Skip cells that are pure numbers stringified.
    if (/^-?\d+(\.\d+)?$/.test(text)) continue;
    if (!best || text.length > best.length) best = text;
  }
  return best;
}

function stripCustomerCode(name: string): string {
  return name.replace(TRAILING_CUSTOMER_CODE_RE, "").trim();
}

function inferLatestMonthDate(
  rows: unknown[][],
  subtotalIdx: number,
  monthMap: MonthColumnMap,
  reportYear: number
): Date | null {
  // Walk backwards from the subtotal row to find the closest data row that
  // populates any month column. Pick the latest month with a non-zero value.
  for (let r = subtotalIdx - 1; r >= 0 && r >= subtotalIdx - 6; r--) {
    const row = rows[r];
    if (!row) continue;
    let latestMonth: number | null = null;
    for (const [col, monthIdx] of monthMap.byCol.entries()) {
      const v = row[col];
      if (typeof v !== "number" || !Number.isFinite(v) || v === 0) continue;
      if (latestMonth === null || monthIdx > latestMonth) latestMonth = monthIdx;
    }
    if (latestMonth !== null) {
      // Last day of that month, in the report year.
      return new Date(reportYear, latestMonth + 1, 0);
    }
  }
  return null;
}

function stringOrNull(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  const s = String(value).trim();
  return s ? s : null;
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
      vatAdjusted: false,
    },
  };
}
