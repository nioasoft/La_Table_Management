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
