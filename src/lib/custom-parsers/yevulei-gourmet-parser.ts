/**
 * Custom parser for יבולי גורמה (YEVULEI_GOURMET) supplier files.
 *
 * The supplier exports from a Hebrew accounting system and has shipped TWO
 * report layouts over time. This parser auto-detects which one it was handed
 * and dispatches accordingly.
 *
 * ── Format A: "documents report" (current, since 2026-06) ──────────────────
 *   Sheet name starts with "דוח" (e.g. "דוח מסמכי מכירה"). One row per sales
 *   document (in practice, one row per customer per month). Header row holds:
 *
 *     סה"כ | מע"מ | הנחה | ללא מע"מ | ... | שם לקוח | מס' לקוח | קוד מיון | תאריך | אסמכתא | מספר מסמך
 *
 *   - "סה\"כ"     = total WITH VAT, AFTER discount  (headline amount)
 *   - "מע\"מ"     = VAT
 *   - "הנחה"      = discount (negative)
 *   - "ללא מע\"מ" = net BEFORE discount  (NOT the commission base)
 *   - "שם לקוח"   = customer / franchisee name
 *   - "תאריך"     = document date (Excel serial or Date)
 *
 *   Commission base = net AFTER discount, EXCLUDING VAT = "סה\"כ" − "מע\"מ"
 *   (confirmed with the client 2026-06-03). The supplier is vat_exempt, so
 *   VAT is never part of the base; the discount is already baked into "סה\"כ".
 *
 *   Two trailing total rows ("‎: סה\"כ למסמך" and "‎: סה\"כ לדו\"ח") are skipped.
 *   Files may be filtered to a single customer (a sample), so we NEVER validate
 *   the row sum against the grand-total row.
 *
 * ── Format B: "monthly sales pivot" (legacy) ──────────────────────────────
 *   Sheet name starts with "דוח מכירות". Customers × Hebrew-month columns with
 *   a per-customer subtotal row (col text "‎: סה\"כ"). One emitted row per
 *   customer; the date is inferred from the latest populated month column.
 *   Kept for backward compatibility with historical uploads.
 *
 * Customer cells may include a trailing supplier-internal customer code
 * (e.g. "ויני חדרה מול החוף בע\"מ  1238"); it is stripped before alias matching.
 *
 * Commission setup (DB): commission_type=percentage, default 10%, vat_exempt=true.
 * vat_exempt post-processing in file-processor.ts collapses gross to net; this
 * parser emits gross = net so totals stay consistent if vat_exempt is flipped.
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

const SHEET_PREFIX = "דוח";
const LEGACY_SHEET_PREFIX = "דוח מכירות";

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

// Normalized header labels for the documents-report layout (Format A).
// normalizeHeaderText strips quotes, colons, bidi marks and whitespace.
const HDR_TOTAL = "סהכ"; // סה"כ  (total incl VAT, after discount)
const HDR_VAT = "מעמ"; // מע"מ
const HDR_NET = "ללאמעמ"; // ללא מע"מ (net before discount)
const HDR_NAME = "שםלקוח"; // שם לקוח
const HDR_DATE = "תאריך"; // תאריך

interface MonthColumnMap {
  // Map of sheet column index -> calendar month index (0=Jan, 11=Dec).
  byCol: Map<number, number>;
}

interface ParsedSection {
  franchisee: string;
  total: number;
  date: Date | null;
}

interface DocHeaderMap {
  headerRow: number;
  totalCol: number;
  vatCol: number | null;
  nameCol: number;
  dateCol: number | null;
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
    // NOTE: do NOT pass cellDates:true — it yields Date objects shifted by the
    // runtime timezone (serial 46053 → Jan 30 instead of Jan 31). We read raw
    // serials and convert via SSF.parse_date_code into a local Date (toDate).
    const workbook = XLSX.read(buffer, { type: "buffer" });

    // Prefer a "דוח…" sheet (covers both layouts); fall back to first sheet.
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
        createFileProcessingError("PARSE_ERROR", { details: "Sheet is empty" })
      );
      legacyErrors.push("Sheet is empty");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    // ── Format detection ────────────────────────────────────────────────
    // Format A (documents report) has a header row with both a "שם לקוח"
    // column and a "ללא מע"מ" column. Anything else falls back to the legacy
    // monthly pivot (Format B).
    const docHeader = findDocHeader(rows);
    if (docHeader) {
      return parseDocumentReport(
        rows,
        docHeader,
        data,
        errors,
        warnings,
        legacyErrors,
        legacyWarnings
      );
    }

    return parseMonthlyPivot(
      rows,
      sheetName,
      data,
      errors,
      warnings,
      legacyErrors,
      legacyWarnings
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    errors.push(createFileProcessingError("SYSTEM_ERROR", { details: message }));
    legacyErrors.push(message);
    return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
  }
}

// ============================================================================
// Format A — documents report (current)
// ============================================================================

function findDocHeader(rows: unknown[][]): DocHeaderMap | null {
  for (let r = 0; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;

    let totalCol = -1;
    let vatCol = -1;
    let nameCol = -1;
    let dateCol = -1;
    let hasNet = false;

    for (let c = 0; c < row.length; c++) {
      const norm = normalizeHeaderText(row[c]);
      if (!norm) continue;
      if (norm === HDR_TOTAL && totalCol < 0) totalCol = c;
      else if (norm === HDR_VAT && vatCol < 0) vatCol = c;
      else if (norm === HDR_NET) hasNet = true;
      else if (norm === HDR_NAME && nameCol < 0) nameCol = c;
      else if (norm === HDR_DATE && dateCol < 0) dateCol = c;
    }

    // Require the two distinctive columns plus a usable total column.
    if (nameCol >= 0 && hasNet && totalCol >= 0) {
      return {
        headerRow: r,
        totalCol,
        vatCol: vatCol >= 0 ? vatCol : null,
        nameCol,
        dateCol: dateCol >= 0 ? dateCol : null,
      };
    }
  }
  return null;
}

function parseDocumentReport(
  rows: unknown[][],
  header: DocHeaderMap,
  data: ParsedRowData[],
  errors: FileProcessingError[],
  warnings: FileProcessingError[],
  legacyErrors: string[],
  legacyWarnings: string[]
): FileProcessingResult {
  let totalGrossAmount = 0;
  let totalNetAmount = 0;
  let rowNumber = 0;

  for (let r = header.headerRow + 1; r < rows.length; r++) {
    const row = rows[r];
    if (!row) continue;

    const name = stringOrNull(row[header.nameCol]);
    // Total rows (": סה"כ למסמך" / ": סה"כ לדו"ח") carry their label in a
    // different column and leave the name column empty — skip those plus blanks.
    if (!name) continue;
    if (SUBTOTAL_RE.test(name) || GRAND_TOTAL_RE.test(name)) continue;

    const total = numberAt(row[header.totalCol]);
    if (total === null) continue;

    const vat =
      header.vatCol !== null ? numberAt(row[header.vatCol]) ?? 0 : 0;

    // Commission base: net after discount, excluding VAT.
    // "סה\"כ" is already after discount; subtract VAT to drop the tax.
    const base = total - vat;
    const netAmount = roundAmount(base);
    if (netAmount === 0) continue; // drop zero-value noise rows

    // vat_exempt supplier → emit gross = net (file-processor collapses anyway).
    const grossAmount = netAmount;

    const franchisee = stripCustomerCode(name);
    const date =
      header.dateCol !== null ? toDate(row[header.dateCol]) : null;

    data.push({
      franchisee,
      date,
      grossAmount,
      netAmount,
      originalAmount: netAmount,
      rowNumber: ++rowNumber,
    });

    totalGrossAmount += grossAmount;
    totalNetAmount += netAmount;
  }

  if (data.length === 0) {
    errors.push(
      createFileProcessingError("PARSE_ERROR", {
        details:
          'Documents report detected but no data rows found below the header.',
      })
    );
    legacyErrors.push("No data rows found in documents report");
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
}

// ============================================================================
// Format B — monthly sales pivot (legacy)
// ============================================================================

function parseMonthlyPivot(
  rows: unknown[][],
  sheetName: string,
  data: ParsedRowData[],
  errors: FileProcessingError[],
  warnings: FileProcessingError[],
  legacyErrors: string[],
  legacyWarnings: string[]
): FileProcessingResult {
  if (!sheetName.startsWith(LEGACY_SHEET_PREFIX)) {
    // Not the legacy layout either — surface a clear, actionable error rather
    // than silently emitting nothing.
    warnings.push(
      createFileProcessingError("PARSE_ERROR", {
        details: `Unrecognized Yevulei Gourmet layout on sheet "${sheetName}". Expected a documents report (header with "שם לקוח" + "ללא מע\\"מ") or a monthly pivot ("דוח מכירות").`,
      })
    );
    legacyWarnings.push(
      `Unrecognized Yevulei Gourmet layout on sheet "${sheetName}"`
    );
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
          'No customer subtotal rows found. Expected rows with cell text ":סה\\"כ".',
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
}

// ============================================================================
// Helpers
// ============================================================================

function normalizeHeaderText(value: unknown): string | null {
  if (value === null || value === undefined) return null;
  // Strip quotes, colons, bidi/zero-width marks and all whitespace so header
  // matching is robust to "מע\"מ", " מע מ ", trailing colons, RLM marks, etc.
  const s = String(value)
    .replace(/[\s"'״׳:‎‏​‌‍﻿]/g, "")
    .trim();
  return s ? s : null;
}

function numberAt(value: unknown): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  if (typeof value === "string") {
    const cleaned = value.replace(/[,₪\s]/g, "");
    if (cleaned === "") return null;
    const n = Number.parseFloat(cleaned);
    return Number.isFinite(n) ? n : null;
  }
  return null;
}

function toDate(value: unknown): Date | null {
  if (value instanceof Date && !Number.isNaN(value.getTime())) return value;
  if (typeof value === "number" && Number.isFinite(value)) {
    // Excel serial → local Date (avoid UTC/toISOString shifting the day).
    const parsed = XLSX.SSF?.parse_date_code?.(value);
    if (parsed && parsed.y) {
      return new Date(parsed.y, parsed.m - 1, parsed.d);
    }
  }
  return null;
}

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
  let best: string | null = null;
  for (const cell of row) {
    const text = stringOrNull(cell);
    if (!text) continue;
    if (SUBTOTAL_RE.test(text) || GRAND_TOTAL_RE.test(text)) continue;
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
