/**
 * Parser for Tabit royalty revenue exports.
 *
 * This is intentionally separate from tabit-parser.ts. That parser handles a
 * payment-method pivot and creates client documents; this parser extracts
 * monthly receipts and tips for franchisee royalty billing.
 */

import * as XLSX from "xlsx";
// SheetJS ESM builds do not bundle legacy Windows codepages. Registering the
// full table here keeps Hebrew CP1255 readable in both browser and server
// bundles. The CJS build loads it internally and exposes no set_cptable.
// @ts-expect-error -- third-party codepage bundle has no type declarations
import * as cpexcel from "xlsx/dist/cpexcel.full.mjs";

if (typeof XLSX.set_cptable === "function") {
  XLSX.set_cptable(cpexcel);
}

const SUPPORTED_MIME_TYPES = new Set([
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
  "application/vnd.ms-excel",
  "application/octet-stream",
]);

const HEBREW_MONTHS: Readonly<Record<string, number>> = {
  ינואר: 1,
  פברואר: 2,
  מרץ: 3,
  אפריל: 4,
  מאי: 5,
  יוני: 6,
  יולי: 7,
  אוגוסט: 8,
  ספטמבר: 9,
  אוקטובר: 10,
  נובמבר: 11,
  דצמבר: 12,
};

interface ColumnMap {
  branch: number;
  receipts: number;
  tips: number;
  period: number | null;
}

export interface RoyaltyRevenuePeriod {
  month: number;
  year: number;
}

export interface RoyaltyRevenueRow {
  branchName: string;
  receipts: number | null;
  tips: number | null;
  period: RoyaltyRevenuePeriod | null;
  missingBranchName: boolean;
  /** True when the receipts cell is blank or cannot be parsed as a number. */
  missingReceipts: boolean;
  /** True when the tips cell is blank or cannot be parsed as a number. */
  missingTips: boolean;
}

export interface RoyaltyRevenueData {
  rows: RoyaltyRevenueRow[];
}

export interface RoyaltyRevenueParseResult {
  success: boolean;
  /**
   * Parsed rows remain available when period validation fails so the upload
   * review can show the actual branches and amounts behind the blocking error.
   */
  data: RoyaltyRevenueData | null;
  errors: string[];
  warnings: string[];
}

interface ParsedDataRow {
  row: RoyaltyRevenueRow | null;
  errors: string[];
}

function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/["'״׳]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

function findPeriodColumn(headers: readonly unknown[]): number | null {
  const index = headers.findIndex((value) => {
    const header = normalizeHeader(value);
    return (
      header === "תקופה" ||
      header === "חודש" ||
      (header.includes("שנה") && header.includes("חודש"))
    );
  });
  return index >= 0 ? index : null;
}

function findColumns(headers: readonly unknown[]): ColumnMap | null {
  const normalized = headers.map(normalizeHeader);
  const branch = normalized.findIndex((header) => header === "סניף");
  const receipts = normalized.findIndex((header) => header === "סהכ תקבולים");
  const tips = normalized.findIndex((header) => header === "סהכ טיפ");

  if (branch < 0 || receipts < 0 || tips < 0) {
    return null;
  }

  return { branch, receipts, tips, period: findPeriodColumn(headers) };
}

/**
 * A Tabit export filtered to one branch is usually grouped by month instead,
 * which drops the branch name from the workbook entirely. The amounts alone
 * prove it is a revenue export, so the message points at the real fix.
 */
function missingHeaderError(rows: readonly (readonly unknown[])[]): string {
  const hasAmountHeader = rows.some((row) =>
    row.map(normalizeHeader).includes("סהכ תקבולים"),
  );
  return hasAmountHeader
    ? "הקובץ אינו מקובץ לפי סניף — ייצאי מטאבית בקיבוץ לפי סניף"
    : 'לא נמצאו כותרות "סניף", "סה״כ תקבולים" ו"סה״כ טיפ"';
}

function findHeaderRow(
  rows: readonly (readonly unknown[])[],
): { index: number; columns: ColumnMap } | null {
  for (let index = 0; index < rows.length; index += 1) {
    const columns = findColumns(rows[index]);
    if (columns) {
      return { index, columns };
    }
  }
  return null;
}

function parseAmount(value: unknown): number | null {
  if (typeof value === "number") {
    return Number.isFinite(value) ? value : null;
  }
  if (value === null || value === undefined || value === "") {
    return null;
  }

  const normalized = String(value)
    .trim()
    .replace(/[₪,\s]/g, "")
    .replace(/^\((.+)\)$/, "-$1");
  if (normalized === "") {
    return null;
  }

  const amount = Number(normalized);
  return Number.isFinite(amount) ? amount : null;
}

function parseNumericPeriod(value: string): RoyaltyRevenuePeriod | null {
  const yearFirst = value.match(/\b(20\d{2})[-./](0?[1-9]|1[0-2])\b/);
  const monthFirst = value.match(/\b(0?[1-9]|1[0-2])[-./](20\d{2})\b/);
  const compact = value.match(/\b(20\d{2})(0[1-9]|1[0-2])\b/);

  if (yearFirst) {
    return { year: Number(yearFirst[1]), month: Number(yearFirst[2]) };
  }
  if (monthFirst) {
    return { year: Number(monthFirst[2]), month: Number(monthFirst[1]) };
  }
  if (compact) {
    return { year: Number(compact[1]), month: Number(compact[2]) };
  }
  return null;
}

function parsePeriod(value: unknown): RoyaltyRevenuePeriod | null {
  const text = String(value ?? "").trim();
  const yearMatch = text.match(/\b(20\d{2})\b/);

  if (yearMatch) {
    const monthEntry = Object.entries(HEBREW_MONTHS).find(([monthName]) =>
      text.includes(monthName),
    );
    if (monthEntry) {
      return { year: Number(yearMatch[1]), month: monthEntry[1] };
    }
  }

  return parseNumericPeriod(text);
}

const FILTER_ROW_MARKER = "מסננים שהוחלו";

function rowText(row: readonly unknown[]): string {
  return row.map((value) => String(value ?? "")).join(" ");
}

/** dd/mm/yyyy — the format Reut reads, built without touching UTC. */
function formatIsoDate(iso: string): string {
  const [year, month, day] = iso.split("-");
  return `${day}/${month}/${year}`;
}

function findFilterRange(
  rows: readonly (readonly unknown[])[],
): { from: string; to: string } | null {
  const text = rows
    .filter((row) => rowText(row).includes(FILTER_ROW_MARKER))
    .map(rowText)
    .join(" ");
  const from = text.match(/fromDate\D*(\d{4}-\d{2}-\d{2})/)?.[1];
  const to = text.match(/toDate\D*(\d{4}-\d{2}-\d{2})/)?.[1];
  return from && to ? { from, to } : null;
}

/**
 * Tabit's year-grouped export carries its real range only in the applied-filters
 * footer. A range that leaves the month is rejected rather than guessed: the
 * totals are already aggregated, so a quarter billed as a month is invisible.
 */
function resolveFilterPeriod(rows: readonly (readonly unknown[])[]): {
  period: RoyaltyRevenuePeriod | null;
  error: string | null;
} {
  const range = findFilterRange(rows);
  if (!range) {
    return { period: null, error: "הקובץ אינו מקובץ לפי חודש" };
  }

  const [fromYear, fromMonth] = range.from.split("-").map(Number);
  const [toYear, toMonth, toDay] = range.to.split("-").map(Number);
  const monthsApart = (toYear - fromYear) * 12 + (toMonth - fromMonth);
  const isSingleMonth =
    monthsApart === 0 || (monthsApart === 1 && toDay === 1);

  if (!isSingleMonth) {
    return {
      period: null,
      error: `הקובץ מכסה ${formatIsoDate(range.from)}–${formatIsoDate(range.to)} — יותר מחודש אחד. ייצאי מטאבית קובץ של חודש בודד`,
    };
  }

  return { period: { year: fromYear, month: fromMonth }, error: null };
}

function isMetadataRow(row: readonly unknown[], branchName: string): boolean {
  return (
    rowText(row).includes(FILTER_ROW_MARKER) ||
    branchName.toLowerCase() === "total" ||
    branchName.includes("סניף מסוף רישתי")
  );
}

function parseDataRow(
  sourceRow: readonly unknown[],
  columns: ColumnMap,
  spreadsheetRow: number,
): ParsedDataRow {
  const branchName = String(sourceRow[columns.branch] ?? "").trim();
  const isBlankRow = sourceRow.every(
    (value) => String(value ?? "").trim() === "",
  );
  if (isBlankRow) {
    return { row: null, errors: [] };
  }
  if (isMetadataRow(sourceRow, branchName)) {
    return { row: null, errors: [] };
  }

  const receipts = parseAmount(sourceRow[columns.receipts]);
  const tips = parseAmount(sourceRow[columns.tips]);
  if (branchName === "" && receipts === 0 && tips === 0) {
    return { row: null, errors: [] };
  }

  const period =
    columns.period === null ? null : parsePeriod(sourceRow[columns.period]);
  const errors =
    columns.period !== null && period === null
      ? [`לא ניתן לזהות חודש בשורה ${spreadsheetRow}`]
      : [];

  return {
    row: {
      branchName,
      receipts,
      tips,
      period,
      missingBranchName: branchName === "",
      missingReceipts: receipts === null,
      missingTips: tips === null,
    },
    errors,
  };
}

function parseRows(
  sourceRows: readonly (readonly unknown[])[],
  headerIndex: number,
  columns: ColumnMap,
): { rows: RoyaltyRevenueRow[]; errors: string[] } {
  const parsed = sourceRows
    .slice(headerIndex + 1)
    .map((row, index) => parseDataRow(row, columns, headerIndex + index + 2));

  return {
    rows: parsed.flatMap(({ row }) => (row ? [row] : [])),
    errors: parsed.flatMap(({ errors }) => errors),
  };
}

function isSupportedMimeType(mimeType: string): boolean {
  return (
    SUPPORTED_MIME_TYPES.has(mimeType) ||
    mimeType.includes("excel") ||
    mimeType.includes("spreadsheet")
  );
}

function parseWorksheet(
  sheet: XLSX.WorkSheet,
  warnings: string[],
): RoyaltyRevenueParseResult {
  const sourceRows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: "",
    blankrows: true,
  });
  const header = findHeaderRow(sourceRows);
  if (!header) {
    return {
      success: false,
      data: null,
      errors: [missingHeaderError(sourceRows)],
      warnings,
    };
  }

  const parsed = parseRows(sourceRows, header.index, header.columns);
  const fallback =
    header.columns.period === null ? resolveFilterPeriod(sourceRows) : null;
  const filePeriod = fallback?.period ?? null;
  const rows = filePeriod
    ? parsed.rows.map((row) => ({ ...row, period: filePeriod }))
    : parsed.rows;
  const errors = [
    ...(fallback?.error ? [fallback.error] : []),
    ...parsed.errors,
    ...(rows.length === 0 ? ["לא נמצאו שורות נתונים בקובץ"] : []),
  ];

  return {
    success: errors.length === 0,
    data: { rows },
    errors,
    warnings,
  };
}

/**
 * Parse a Tabit export containing monthly receipts and tips per branch.
 */
export function parseRoyaltyRevenueFile(
  buffer: Buffer,
  mimeType: string,
): RoyaltyRevenueParseResult {
  const warnings: string[] = [];
  if (!isSupportedMimeType(mimeType)) {
    return {
      success: false,
      data: null,
      errors: [`סוג קובץ לא נתמך: ${mimeType}. נדרש קובץ Excel.`],
      warnings,
    };
  }

  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    const sheet = sheetName ? workbook.Sheets[sheetName] : undefined;
    if (!sheet) {
      return {
        success: false,
        data: null,
        errors: ["קובץ Excel ריק — אין גיליונות"],
        warnings,
      };
    }

    return parseWorksheet(sheet, warnings);
  } catch (error: unknown) {
    const message = error instanceof Error ? error.message : String(error);
    return {
      success: false,
      data: null,
      errors: [`שגיאה בקריאת קובץ טאבית: ${message}`],
      warnings,
    };
  }
}
