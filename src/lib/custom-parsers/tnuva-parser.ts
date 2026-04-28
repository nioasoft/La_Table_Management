/**
 * Custom parser for תנובה (TNUVA) annual commission files
 *
 * File structure: single workbook with two relevant sheets.
 *   - מכר (sales): line-item rows, one per (franchisee × month × product).
 *     Column W = "מכירה בשח נטו" (net sale, after line discounts, before VAT).
 *     Column I = "מספר לקוח" (Tnuva customer ID, the join key).
 *     Column J = "שם לקוח" (customer name, may vary across rows).
 *
 *   - תחשיב (calculation): per-franchisee summary, ~13 rows below a category
 *     summary block. Headers row contains: רשת, מספר לקוח, שם לקוח, then
 *     category columns and finally "מענק מחושב" (calculated commission).
 *     Column I = the supplier's pre-calculated commission per franchisee
 *     (already excludes butter, applies the 6%/7%/5% category rates).
 *     Last row has A === "סיכום" (totals) — must be skipped.
 *
 * Strategy:
 *   1. Read תחשיב to get { customerId → { name, commission } }.
 *   2. Read מכר and sum column W per customer ID → purchases (netAmount).
 *   3. Emit one ParsedRowData per customer ID present in either sheet,
 *      using תחשיב.I as preCalculatedCommission so downstream logic trusts
 *      Tnuva's own calculation instead of recomputing from rates.
 *   4. VAT: net = sum(W), gross = net × 1.18 (matches AVRAHAMI convention).
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

const SHEET_SALES = "מכר";
const SHEET_CALC = "תחשיב";

const HEADER_NETWORK = "רשת";
const HEADER_CUSTOMER_ID = "מספר לקוח";
const HEADER_CUSTOMER_NAME = "שם לקוח";
const HEADER_COMMISSION = "מענק מחושב";
const HEADER_NET_SALE = "מכירה בשח נטו";
const TOTALS_LABEL = "סיכום";

interface CalcRow {
  name: string;
  commission: number;
  rowNumber: number;
}

/**
 * Parse a Tnuva annual commission workbook.
 */
export function parseTnuvaFile(buffer: Buffer): FileProcessingResult {
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

    const calcSheet = workbook.Sheets[SHEET_CALC];
    const salesSheet = workbook.Sheets[SHEET_SALES];

    if (!calcSheet || !salesSheet) {
      const missing: string[] = [];
      if (!calcSheet) missing.push(`"${SHEET_CALC}"`);
      if (!salesSheet) missing.push(`"${SHEET_SALES}"`);
      const detail = `Missing required sheet(s): ${missing.join(", ")}. Found: ${workbook.SheetNames.join(", ")}`;
      errors.push(
        createFileProcessingError("NO_WORKSHEETS", { details: detail }),
      );
      legacyErrors.push(detail);
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    const calcByCustomer = parseCalcSheet(calcSheet, errors, legacyErrors);
    if (calcByCustomer === null) {
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    const salesByCustomer = parseSalesSheet(salesSheet, errors, legacyErrors);
    if (salesByCustomer === null) {
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    const allCustomerIds = new Set<number>([
      ...calcByCustomer.keys(),
      ...salesByCustomer.keys(),
    ]);

    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let rowNumber = 0;

    for (const customerId of allCustomerIds) {
      const calc = calcByCustomer.get(customerId);
      const salesNet = salesByCustomer.get(customerId) ?? 0;

      const netAmount = roundAmount(salesNet);
      const grossAmount = roundAmount(salesNet * (1 + VAT_RATE));
      const preCalculatedCommission = roundAmount(calc?.commission ?? 0);

      const franchisee = calc?.name ?? `Tnuva customer ${customerId}`;

      // Surface mismatches as warnings (don't fail the whole file).
      if (!calc) {
        const w = createCustomError(
          "TNUVA_MISSING_IN_CALC",
          "validation",
          "warning",
          `Customer ${customerId} appears in ${SHEET_SALES} but not in ${SHEET_CALC} — no commission row found.`,
          { value: String(customerId) },
        );
        warnings.push(w);
        legacyWarnings.push(w.message);
      } else if (salesNet === 0 && calc.commission !== 0) {
        const w = createCustomError(
          "TNUVA_MISSING_IN_SALES",
          "validation",
          "warning",
          `Customer ${customerId} (${calc.name}) appears in ${SHEET_CALC} but has no rows in ${SHEET_SALES}.`,
          { value: String(customerId) },
        );
        warnings.push(w);
        legacyWarnings.push(w.message);
      }

      data.push({
        franchisee,
        franchiseeId: String(customerId),
        date: null,
        grossAmount,
        netAmount,
        originalAmount: netAmount,
        rowNumber: ++rowNumber,
        preCalculatedCommission,
      });

      totalGrossAmount += grossAmount;
      totalNetAmount += netAmount;
      processedRows++;
    }

    if (processedRows === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "No franchisee rows could be extracted from the Tnuva workbook.",
        }),
      );
      legacyErrors.push("No franchisee rows could be extracted from the Tnuva workbook.");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    return createResult(
      true,
      data,
      errors,
      warnings,
      legacyErrors,
      legacyWarnings,
      processedRows,
      processedRows,
      0,
      totalGrossAmount,
      totalNetAmount,
    );
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    errors.push(
      createFileProcessingError("SYSTEM_ERROR", { details: message }),
    );
    legacyErrors.push(message);
    return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
  }
}

/**
 * Parse the תחשיב sheet into a map of customer ID → { name, commission }.
 * Returns null on a fatal error (errors/legacyErrors already populated).
 */
function parseCalcSheet(
  sheet: XLSX.WorkSheet,
  errors: FileProcessingError[],
  legacyErrors: string[],
): Map<number, CalcRow> | null {
  const rows = sheetToRows(sheet);

  const headerIdx = rows.findIndex(
    (row) =>
      cellEquals(row, HEADER_NETWORK) &&
      cellEquals(row, HEADER_CUSTOMER_ID) &&
      cellEquals(row, HEADER_COMMISSION),
  );

  if (headerIdx === -1) {
    errors.push(
      createFileProcessingError("HEADER_ROW_NOT_FOUND", {
        details: `Could not locate per-franchisee header row in "${SHEET_CALC}". Expected columns "${HEADER_NETWORK}", "${HEADER_CUSTOMER_ID}", "${HEADER_COMMISSION}".`,
      }),
    );
    legacyErrors.push(`Header row not found in ${SHEET_CALC}`);
    return null;
  }

  const header = rows[headerIdx] ?? [];
  const customerIdCol = findColumn(header, HEADER_CUSTOMER_ID);
  const customerNameCol = findColumn(header, HEADER_CUSTOMER_NAME);
  const commissionCol = findColumn(header, HEADER_COMMISSION);
  const networkCol = findColumn(header, HEADER_NETWORK);

  if (customerIdCol === -1 || commissionCol === -1) {
    errors.push(
      createFileProcessingError("HEADER_ROW_NOT_FOUND", {
        details: `Required columns missing in "${SHEET_CALC}". Header: ${JSON.stringify(header)}`,
      }),
    );
    legacyErrors.push("Required columns missing in תחשיב");
    return null;
  }

  const result = new Map<number, CalcRow>();

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row || row.every((cell) => cell === null || cell === undefined || cell === "")) {
      continue;
    }

    // The totals row uses A = "סיכום" — skip it. Same for any row whose
    // network column says "סיכום" (defensive).
    const network = String(row[networkCol] ?? "").trim();
    const firstCell = String(row[0] ?? "").trim();
    if (network === TOTALS_LABEL || firstCell === TOTALS_LABEL) continue;

    const customerId = toNumber(row[customerIdCol]);
    if (customerId === null || customerId <= 0) continue;

    const name =
      customerNameCol >= 0 ? String(row[customerNameCol] ?? "").trim() : "";
    const commission = toNumber(row[commissionCol]) ?? 0;

    result.set(customerId, {
      name: name || `Tnuva customer ${customerId}`,
      commission,
      rowNumber: i + 1,
    });
  }

  return result;
}

/**
 * Sum the מכר sheet's net-sale column per customer ID.
 * Returns null on a fatal error.
 */
function parseSalesSheet(
  sheet: XLSX.WorkSheet,
  errors: FileProcessingError[],
  legacyErrors: string[],
): Map<number, number> | null {
  const rows = sheetToRows(sheet);

  const headerIdx = rows.findIndex(
    (row) =>
      cellEquals(row, HEADER_CUSTOMER_ID) && cellEquals(row, HEADER_NET_SALE),
  );

  if (headerIdx === -1) {
    errors.push(
      createFileProcessingError("HEADER_ROW_NOT_FOUND", {
        details: `Could not locate header row in "${SHEET_SALES}". Expected columns "${HEADER_CUSTOMER_ID}" and "${HEADER_NET_SALE}".`,
      }),
    );
    legacyErrors.push(`Header row not found in ${SHEET_SALES}`);
    return null;
  }

  const header = rows[headerIdx] ?? [];
  const customerIdCol = findColumn(header, HEADER_CUSTOMER_ID);
  const netSaleCol = findColumn(header, HEADER_NET_SALE);

  if (customerIdCol === -1 || netSaleCol === -1) {
    errors.push(
      createFileProcessingError("HEADER_ROW_NOT_FOUND", {
        details: `Required columns missing in "${SHEET_SALES}".`,
      }),
    );
    legacyErrors.push("Required columns missing in מכר");
    return null;
  }

  const result = new Map<number, number>();

  for (let i = headerIdx + 1; i < rows.length; i++) {
    const row = rows[i];
    if (!row) continue;

    const customerId = toNumber(row[customerIdCol]);
    if (customerId === null || customerId <= 0) continue;

    const netSale = toNumber(row[netSaleCol]) ?? 0;
    result.set(customerId, (result.get(customerId) ?? 0) + netSale);
  }

  return result;
}

// ============================================================================
// Helpers
// ============================================================================

function sheetToRows(sheet: XLSX.WorkSheet): unknown[][] {
  return XLSX.utils.sheet_to_json<unknown[]>(sheet, {
    header: 1,
    raw: true,
    defval: null,
    blankrows: false,
  });
}

function cellEquals(row: unknown[] | undefined, target: string): boolean {
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
