/**
 * Custom parser for דיפלומט (DIPLOMAT) supplier files.
 *
 * Month-matrix layout (first seen Q2-2026):
 *   - Header row (located by the "Customer" cell, not by index):
 *       Customer | Year-Month | 2026-April | 2026-May | 2026-June
 *     Month columns are any header matching "<year>-<English month>".
 *   - One row per franchisee; each month cell holds the NET amount for that
 *     month ("-" or empty = no sales that month).
 *   - Grand-total row has an empty Customer cell — skipped.
 *
 * One ParsedRowData is emitted per franchisee per month, dated to the last
 * day of that month, so the upload route can derive the settlement period
 * from the file content. Amounts are net (supplier vat_included=false);
 * gross = net × (1 + vatRate).
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  ISRAEL_VAT_RATE,
  roundAmount,
} from "../file-processor";
import {
  type FileProcessingError,
  createFileProcessingError,
} from "../file-processing-errors";

const HEADER_SCAN_ROWS = 10;

const MONTH_INDEX: Record<string, number> = {
  january: 0,
  february: 1,
  march: 2,
  april: 3,
  may: 4,
  june: 5,
  july: 6,
  august: 7,
  september: 8,
  october: 9,
  november: 10,
  december: 11,
};

const MONTH_HEADER_RE = /^(\d{4})[-\s]+([A-Za-z]+)$/;

interface MonthColumn {
  col: number;
  /** Last day of the month, local time (never toISOString — Israel TZ) */
  date: Date;
}

function parseMonthHeader(header: string): Date | null {
  const match = header.trim().match(MONTH_HEADER_RE);
  if (!match) return null;
  const year = parseInt(match[1], 10);
  const month = MONTH_INDEX[match[2].toLowerCase()];
  if (month === undefined) return null;
  // Day 0 of the next month = last day of this month
  return new Date(year, month + 1, 0);
}

function toNumber(value: unknown): number | null {
  if (value === null || value === undefined || value === "") return null;
  if (typeof value === "number") return isNaN(value) ? null : value;
  const cleaned = String(value).replace(/[,₪\s]/g, "").trim();
  if (!cleaned || cleaned === "-") return null;
  const parsed = parseFloat(cleaned);
  return isNaN(parsed) ? null : parsed;
}

export function parseDiplomatFile(
  buffer: Buffer,
  vatRate: number = ISRAEL_VAT_RATE
): FileProcessingResult {
  const errors: FileProcessingError[] = [];
  const warnings: FileProcessingError[] = [];
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

    const rawData: unknown[][] = XLSX.utils.sheet_to_json(workbook.Sheets[sheetName], {
      header: 1,
      raw: false,
      defval: "",
    });

    // Locate the header row by its "Customer" cell
    let headerRowIdx = -1;
    let customerCol = -1;
    for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, rawData.length); i++) {
      const idx = (rawData[i] || []).findIndex(
        (c) => String(c ?? "").trim().toLowerCase() === "customer"
      );
      if (idx !== -1) {
        headerRowIdx = i;
        customerCol = idx;
        break;
      }
    }

    if (headerRowIdx === -1) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: 'Header row with a "Customer" column not found',
        })
      );
      legacyErrors.push('Header row with a "Customer" column not found');
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rawData.length);
    }

    const monthColumns: MonthColumn[] = [];
    const headerRow = rawData[headerRowIdx] || [];
    for (let col = 0; col < headerRow.length; col++) {
      const date = parseMonthHeader(String(headerRow[col] ?? ""));
      if (date) monthColumns.push({ col, date });
    }

    if (monthColumns.length === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: 'No month columns (e.g. "2026-April") found in header row',
        })
      );
      legacyErrors.push("No month columns found in Diplomat header row");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rawData.length);
    }

    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let skippedRows = 0;
    let rowNumber = 1;

    for (let i = headerRowIdx + 1; i < rawData.length; i++) {
      const row = rawData[i] || [];
      const franchisee = String(row[customerCol] ?? "").trim();

      // Grand-total row (and any stray footer) has no customer name
      if (!franchisee) {
        skippedRows++;
        continue;
      }

      let emittedForRow = 0;
      for (const { col, date } of monthColumns) {
        const net = toNumber(row[col]);
        if (net === null || net === 0) continue;

        const netRounded = roundAmount(net);
        const grossRounded = roundAmount(net * (1 + vatRate));

        data.push({
          franchisee,
          date,
          grossAmount: grossRounded,
          netAmount: netRounded,
          originalAmount: netRounded,
          rowNumber: rowNumber++,
        });

        totalNetAmount += netRounded;
        totalGrossAmount += grossRounded;
        emittedForRow++;
      }

      if (emittedForRow > 0) {
        processedRows++;
      } else {
        skippedRows++;
      }
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
      skippedRows,
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
