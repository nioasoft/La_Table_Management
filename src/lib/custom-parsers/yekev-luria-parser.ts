/**
 * Custom parser for יקב לוריא (Yekev Luria) supplier files.
 *
 * File structure: a single sheet whose name starts with "דוח מכירות".
 * The report is organised by product. Each item produces a repeating block:
 *
 *   <header>     col M (idx 12) "מכירות {item} פריט מספר {code}"
 *   <sku>        col J (idx 9)  "מק''ט {sku}"                       (sometimes blank)
 *   <blank>
 *   <columns>    col B (idx 1)  "סך הכל ש"ח לאחר הנחה"
 *                col D (idx 3)  "סך הכל ש"ח"
 *                col E (idx 4)  "מחיר ליחידה"
 *                col F (idx 5)  "כמות"
 *                col G (idx 6)  "תאריך"
 *                col H (idx 7)  "מספר מסמך"
 *                col J (idx 9)  "סוג מסמך"
 *                col M (idx 12) "שם לקוח"
 *   <data...>
 *   <subtotal>   col L (idx 11) "סה''כ מכירות {item} ..."
 *
 * After the last item, a single grand-total row is emitted with col G (idx 6)
 * = ":סה\"כ לדוח" — also skipped.
 *
 * Customer cells include the supplier's internal customer code at the end:
 *   "פט ויני עזריאלי בע\"מ אסף נתנזון 50685565"
 * The 8-digit code is not present in franchisee.aliases, so we strip it before
 * passing the name downstream (where fuzzy alias matching happens).
 *
 * Strategy:
 *   1. Walk the rows once with a SEARCHING / IN_BLOCK state machine.
 *   2. Inside a block, sum column B per cleaned customer name across all items
 *      (credit invoices arrive as negative numbers and naturally net out).
 *   3. Emit one ParsedRowData per franchisee. File values are net (pre-VAT);
 *      gross = net × 1.18. preCalculatedCommission is not provided.
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
  createCustomError,
} from "../file-processing-errors";
import type { Anomaly } from "@/types/file-anomalies";

const VAT_RATE = 0.18;

const SHEET_PREFIX = "דוח מכירות";

const HEADER_TOTAL_AFTER_DISCOUNT = 'סך הכל ש"ח לאחר הנחה';
const HEADER_CUSTOMER_NAME = "שם לקוח";

const BLOCK_HEADER_RE = /^מכירות .+?\s+פריט מספר\s+\S+/;
const SUBTOTAL_PREFIX = 'סה"כ מכירות';
const SUBTOTAL_PREFIX_ALT = "סה''כ מכירות";
const GRAND_TOTAL_LABEL = ':סה"כ לדוח';
const GRAND_TOTAL_LABEL_ALT = ":סה''כ לדוח";

const TRAILING_CUSTOMER_CODE_RE = /\s+(\d{6,})\s*$/;

// --- Customer-summary layout (first seen 2026-07, sheet "d_customers_sale_report") ---
// One row per customer: סה"כ סכום | ... | ע.מ. / ת.ז | שם לקוח | מס' לקוח.
// The sheet range starts at B3, so columns are ALWAYS located by header text.
const SUMMARY_HEADER_TOTAL = 'סהכ סכום'; // compared after quote-stripping
const SUMMARY_HEADER_NAME = "שם לקוח";
const SUMMARY_HEADER_CODE = "מס לקוח";
const SUMMARY_HEADER_SCAN_ROWS = 12;
const SUMMARY_PERIOD_RE =
  /מתאריך\s+(\d{1,2}\/\d{1,2}\/\d{2,4})\s+עד\s+תאריך\s+(\d{1,2}\/\d{1,2}\/\d{2,4})/;

/** Strip Hebrew/ASCII quote marks so 'סה"כ' / "סה''כ" / 'סה״כ' all compare equal */
function stripQuotes(value: string): string {
  return value.replace(/["'׳״`]/g, "");
}

interface AggregatedRow {
  cleanedName: string;
  sales: number;
  codes: Set<string>;
  firstRowNumber: number;
}

/**
 * Parse a Yekev Luria sales-by-item workbook.
 */
export function parseYekevLuriaFile(buffer: Buffer): FileProcessingResult {
  const errors: FileProcessingError[] = [];
  const warnings: FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];

  try {
    const workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
    });

    const sheetName =
      workbook.SheetNames.find((name) => name.startsWith(SHEET_PREFIX)) ??
      workbook.SheetNames[0];

    if (!sheetName) {
      errors.push(createFileProcessingError("NO_WORKSHEETS"));
      legacyErrors.push("No worksheets found in file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    const sheet = workbook.Sheets[sheetName];
    if (!sheet) {
      errors.push(
        createFileProcessingError("NO_WORKSHEETS", {
          details: `Sheet "${sheetName}" not found in workbook`,
        }),
      );
      legacyErrors.push(`Sheet "${sheetName}" not found`);
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    const rows = sheetToRows(sheet);

    // Customer-summary layout takes priority — it has no item blocks at all.
    const summaryHeaderIdx = findSummaryHeaderRow(rows);
    if (summaryHeaderIdx !== -1) {
      return parseCustomerSummaryLayout(
        rows,
        summaryHeaderIdx,
        errors,
        warnings,
        legacyErrors,
        legacyWarnings,
      );
    }

    const aggregates = new Map<string, AggregatedRow>();
    let blocksFound = 0;

    let i = 0;
    while (i < rows.length) {
      // SEARCHING — look for the next block header row.
      if (!isBlockHeader(rows[i])) {
        i++;
        continue;
      }

      blocksFound++;
      const blockHeaderRow = i + 1; // 1-indexed for messages
      i++;

      // Find the column-header row within the next 5 rows.
      let columnHeaderIdx = -1;
      for (let j = i; j < Math.min(i + 5, rows.length); j++) {
        if (
          cellMatches(rows[j], HEADER_TOTAL_AFTER_DISCOUNT) &&
          cellMatches(rows[j], HEADER_CUSTOMER_NAME)
        ) {
          columnHeaderIdx = j;
          break;
        }
      }

      if (columnHeaderIdx === -1) {
        const w = createCustomError(
          "LURIA_MISSING_COLUMN_HEADER",
          "validation",
          "warning",
          `Could not locate column header row after item header at row ${blockHeaderRow}.`,
        );
        warnings.push(w);
        legacyWarnings.push(w.message);
        continue;
      }

      const header = rows[columnHeaderIdx] ?? [];
      const totalAfterDiscountCol = findColumn(header, HEADER_TOTAL_AFTER_DISCOUNT);
      const customerNameCol = findColumn(header, HEADER_CUSTOMER_NAME);

      if (totalAfterDiscountCol === -1 || customerNameCol === -1) {
        const w = createCustomError(
          "LURIA_MISSING_COLUMNS",
          "validation",
          "warning",
          `Required columns missing in block at row ${blockHeaderRow}.`,
        );
        warnings.push(w);
        legacyWarnings.push(w.message);
        i = columnHeaderIdx + 1;
        continue;
      }

      // IN_BLOCK — read data rows until we hit a stop signal.
      i = columnHeaderIdx + 1;
      while (i < rows.length) {
        const row = rows[i];

        if (isBlockTerminator(row) || isBlockHeader(row)) {
          break;
        }

        if (!row || row.every(isEmpty)) {
          i++;
          continue;
        }

        const rawNameCell = row[customerNameCol];
        if (rawNameCell === null || rawNameCell === undefined || rawNameCell === "") {
          i++;
          continue;
        }

        const rawName = String(rawNameCell).trim();
        if (!rawName) {
          i++;
          continue;
        }

        const netSale = toNumber(row[totalAfterDiscountCol]);
        if (netSale === null) {
          i++;
          continue;
        }

        const codeMatch = rawName.match(TRAILING_CUSTOMER_CODE_RE);
        const supplierCustomerCode = codeMatch ? codeMatch[1] : null;
        const cleanedName = rawName.replace(TRAILING_CUSTOMER_CODE_RE, "").trim() || rawName;

        const existing = aggregates.get(cleanedName);
        if (existing) {
          existing.sales += netSale;
          if (supplierCustomerCode) existing.codes.add(supplierCustomerCode);
        } else {
          aggregates.set(cleanedName, {
            cleanedName,
            sales: netSale,
            codes: supplierCustomerCode ? new Set([supplierCustomerCode]) : new Set(),
            firstRowNumber: i + 1,
          });
        }

        i++;
      }
    }

    if (blocksFound === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: 'No item blocks found. Expected rows matching "מכירות … פריט מספר …".',
        }),
      );
      legacyErrors.push("No item blocks found in Yekev Luria workbook");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rows.length);
    }

    if (aggregates.size === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "No franchisee rows could be extracted from the Yekev Luria workbook.",
        }),
      );
      legacyErrors.push("No franchisee rows extracted from Yekev Luria workbook");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rows.length);
    }

    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let rowNumber = 0;

    for (const agg of aggregates.values()) {
      const netAmount = roundAmount(agg.sales);
      const grossAmount = roundAmount(agg.sales * (1 + VAT_RATE));

      // Only surface a supplier customer code as franchiseeId when it is
      // unambiguous — multiple codes for the same cleaned name means the
      // file lumps distinct customers under the same display name and we
      // shouldn't pretend to know which one applies.
      const franchiseeId =
        agg.codes.size === 1 ? Array.from(agg.codes)[0] : undefined;

      data.push({
        franchisee: agg.cleanedName,
        franchiseeId,
        date: null,
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
      totalNetAmount,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    errors.push(createFileProcessingError("SYSTEM_ERROR", { details: message }));
    legacyErrors.push(message);
    return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
  }
}

// ============================================================================
// Customer-summary layout
// ============================================================================

/** Row index of the summary-layout header, or -1 when not that layout */
function findSummaryHeaderRow(rows: unknown[][]): number {
  for (let i = 0; i < Math.min(SUMMARY_HEADER_SCAN_ROWS, rows.length); i++) {
    const row = rows[i];
    if (!row) continue;
    const cells = row.map((c) => stripQuotes(String(c ?? "").trim()));
    if (cells.includes(SUMMARY_HEADER_TOTAL) && cells.includes(SUMMARY_HEADER_NAME)) {
      return i;
    }
  }
  return -1;
}

function findColumnStripped(header: unknown[], target: string): number {
  for (let i = 0; i < header.length; i++) {
    const cell = header[i];
    if (cell === null || cell === undefined) continue;
    if (stripQuotes(String(cell).trim()) === target) return i;
  }
  return -1;
}

/**
 * Parse the per-customer summary report. Amounts are treated as NET like the
 * block layout (gross = net × 1.18). The report is CUMULATIVE for the date
 * range in its title (e.g. 01/01–30/06) — surfaced as a MIXED_PERIODS anomaly
 * so the admin never approves it as a single quarter when earlier quarters
 * were already invoiced.
 */
function parseCustomerSummaryLayout(
  rows: unknown[][],
  headerIdx: number,
  errors: FileProcessingError[],
  warnings: FileProcessingError[],
  legacyErrors: string[],
  legacyWarnings: string[],
): FileProcessingResult {
  const data: ParsedRowData[] = [];
  const header = rows[headerIdx] ?? [];
  const totalCol = findColumnStripped(header, SUMMARY_HEADER_TOTAL);
  const nameCol = findColumnStripped(header, SUMMARY_HEADER_NAME);
  const codeCol = findColumnStripped(header, SUMMARY_HEADER_CODE);

  if (totalCol === -1 || nameCol === -1) {
    errors.push(
      createFileProcessingError("PARSE_ERROR", {
        details: "Customer-summary layout detected but required columns are missing.",
      }),
    );
    legacyErrors.push("Customer-summary layout: required columns missing");
    return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rows.length);
  }

  // Extract the report period from the title rows above the header
  let periodText: string | null = null;
  for (let i = 0; i < headerIdx; i++) {
    for (const cell of rows[i] ?? []) {
      if (cell === null || cell === undefined) continue;
      const match = String(cell).match(SUMMARY_PERIOD_RE);
      if (match) {
        periodText = `${match[1]} – ${match[2]}`;
        break;
      }
    }
    if (periodText) break;
  }

  let totalGrossAmount = 0;
  let totalNetAmount = 0;
  let skipped = 0;
  let rowNumber = 0;

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every(isEmpty)) continue;

    const rawName = String(row[nameCol] ?? "").trim();
    // The grand-total row ("סה"כ N לקוחות") has no customer name
    if (!rawName || stripQuotes(rawName).startsWith("סהכ")) {
      skipped++;
      continue;
    }

    const netSale = toNumber(row[totalCol]);
    if (netSale === null || netSale === 0) {
      skipped++;
      continue;
    }

    // Older exports glued the customer code to the name — strip defensively
    const cleanedName = rawName.replace(TRAILING_CUSTOMER_CODE_RE, "").trim() || rawName;
    const codeCell = codeCol === -1 ? null : row[codeCol];
    const franchiseeId =
      codeCell !== null && codeCell !== undefined && String(codeCell).trim() !== ""
        ? String(codeCell).trim()
        : undefined;

    const netAmount = roundAmount(netSale);
    const grossAmount = roundAmount(netSale * (1 + VAT_RATE));

    data.push({
      franchisee: cleanedName,
      franchiseeId,
      date: null,
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
        details: "No customer rows could be extracted from the summary-layout workbook.",
      }),
    );
    legacyErrors.push("No customer rows extracted from Yekev Luria summary workbook");
    return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rows.length);
  }

  const cumulativePeriodAnomaly: Anomaly = {
    code: "MIXED_PERIODS",
    severity: "warning",
    messageHe: periodText
      ? `דוח יקב לוריא מצטבר לתקופה ${periodText} — לא לאשר כרבעון בודד לפני בדיקה מול תקופות שכבר אושרו.`
      : "דוח יקב לוריא במבנה סיכום-לקוחות ללא תאריכי שורה — יש לוודא שהתקופה שתויגה תואמת את טווח הדוח.",
    details: {
      explanationHe:
        "בפורמט החדש של יקב לוריא כל שורה היא סכום מצטבר ללקוח לכל טווח הדוח. אם הטווח חופף תקופה שכבר אושרה (למשל דוח חצי-שנתי אחרי שרבעון 1 כבר חושב), אישור הקובץ כמו-שהוא יכפיל עמלות. יש לבקש מהספק דוח לתקופה הרלוונטית בלבד או לטפל ידנית.",
    },
    suggestedActions: [
      {
        type: "acknowledge_only",
        labelHe: "בדקתי שהתקופה אינה חופפת תקופה שאושרה",
      },
    ],
  };

  const result = createResult(
    true,
    data,
    errors,
    warnings,
    legacyErrors,
    legacyWarnings,
    rows.length,
    data.length,
    skipped,
    totalGrossAmount,
    totalNetAmount,
  );
  return { ...result, anomalies: [cumulativePeriodAnomaly] };
}

// ============================================================================
// Helpers
// ============================================================================

function sheetToRows(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: true,
  });
}

function isBlockHeader(row: unknown[] | undefined): boolean {
  if (!row) return false;
  for (const cell of row) {
    if (cell === null || cell === undefined) continue;
    const s = String(cell).trim();
    if (BLOCK_HEADER_RE.test(s)) return true;
  }
  return false;
}

function isBlockTerminator(row: unknown[] | undefined): boolean {
  if (!row) return false;
  for (const cell of row) {
    if (cell === null || cell === undefined) continue;
    const s = String(cell).trim();
    if (
      s.startsWith(SUBTOTAL_PREFIX) ||
      s.startsWith(SUBTOTAL_PREFIX_ALT) ||
      s === GRAND_TOTAL_LABEL ||
      s === GRAND_TOTAL_LABEL_ALT
    ) {
      return true;
    }
  }
  return false;
}

function cellMatches(row: unknown[] | undefined, target: string): boolean {
  if (!row) return false;
  for (const cell of row) {
    if (cell === null || cell === undefined) continue;
    if (String(cell).trim() === target) return true;
  }
  return false;
}

function findColumn(header: unknown[], target: string): number {
  for (let i = 0; i < header.length; i++) {
    const cell = header[i];
    if (cell === null || cell === undefined) continue;
    if (String(cell).trim() === target) return i;
  }
  return -1;
}

function isEmpty(value: unknown): boolean {
  return value === null || value === undefined || value === "";
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return Number.isFinite(value) ? value : null;
  const cleaned = String(value).replace(/[,₪\s]/g, "");
  const parsed = Number.parseFloat(cleaned);
  return Number.isFinite(parsed) ? parsed : null;
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
  totalNetAmount = 0,
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
