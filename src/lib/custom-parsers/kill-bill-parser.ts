/**
 * Custom parser for קיל ביל (KILL_BILL) supplier files
 *
 * Two layouts supported (auto-detected from headers in row 1):
 *
 * LEGACY layout (grouped, franchisee header row + detail rows):
 *   - Row 0: Period info
 *   - Row 1: Headers (col A "סכום במטבע החשבונית", col G "שם לקוח")
 *   - Col A: Amount (NET)
 *   - Col G: Franchisee name (only on first row of each group)
 *   - "סה״כ" rows mark group boundaries (skip)
 *
 * NEW layout (aggregated rows, headers located by TEXT, not position):
 *   The supplier reshuffles both the header row index and the column order
 *   between exports (seen: headers at row 1 with name at col F; headers at
 *   row 0 with name at col B — Q2-2026). The header row is found by scanning
 *   the first rows for a cell containing "שם לקוח", then columns are mapped
 *   by header text:
 *   - "שם לקוח"            → franchisee name
 *   - "הכנסה" + "מע"       → gross amount with VAT (written "מע\"מ" or "מע'מ")
 *   - "הכנסה" (exact-ish)  → net amount in ש"ח
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundAmount,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

// LEGACY layout column indices
const LEGACY_AMOUNT_COL = 0;
const LEGACY_FRANCHISEE_COL = 6;

const LEGACY_HEADER_ROW = 1;
/** How many leading rows to scan for the header row */
const HEADER_SCAN_ROWS = 5;

const SKIP_KEYWORDS = ['סה"כ', "סהכ", "total", "grand"];

function parseNumericValue(value: unknown): number {
  if (value === null || value === undefined) return 0;
  if (typeof value === "number") return isNaN(value) ? 0 : value;

  let strValue = String(value).trim();
  strValue = strValue
    .replace(/[₪$€£¥]/g, "")
    .replace(/,/g, "")
    .replace(/\s/g, "")
    .trim();

  if (strValue.startsWith("(") && strValue.endsWith(")")) {
    strValue = "-" + strValue.slice(1, -1);
  }

  const parsed = parseFloat(strValue);
  return isNaN(parsed) ? 0 : parsed;
}

function shouldSkipRow(row: unknown[]): boolean {
  const rowText = row.map((cell) => String(cell || "").toLowerCase()).join(" ");
  return SKIP_KEYWORDS.some((keyword) =>
    rowText.includes(keyword.toLowerCase())
  );
}

interface NewLayoutColumns {
  headerRowIdx: number;
  franchiseeCol: number;
  netCol: number;
  grossCol: number;
}

/**
 * Locate the aggregated-layout header row and map its columns by text.
 * Returns null when no such header exists (→ legacy grouped layout).
 */
function detectNewLayout(rawData: unknown[][]): NewLayoutColumns | null {
  for (let i = 0; i < Math.min(HEADER_SCAN_ROWS, rawData.length); i++) {
    const row = rawData[i] || [];
    const headers = row.map((c) => String(c ?? "").trim());

    const franchiseeCol = headers.findIndex((h) => h.includes("שם לקוח"));
    if (franchiseeCol === -1) continue;

    // Gross carries a VAT marker — written "מע\"מ" or "מע'מ" between exports
    const grossCol = headers.findIndex((h) => h.includes("הכנסה") && h.includes("מע"));
    // Net is the bare "הכנסה" — must not match gross or "הכנסה משוערכת"
    let netCol = headers.findIndex((h) => h === "הכנסה");
    if (netCol === -1) {
      netCol = headers.findIndex(
        (h) => h.includes("הכנסה") && !h.includes("מע") && !h.includes("משוערכת")
      );
    }

    if (netCol === -1 && grossCol === -1) continue;

    return { headerRowIdx: i, franchiseeCol, netCol, grossCol };
  }
  return null;
}

export function parseKillBillFile(buffer: Buffer): FileProcessingResult {
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

    const newLayout = detectNewLayout(rawData);
    if (newLayout) {
      return parseNewLayout(rawData, newLayout, errors, warnings, legacyErrors, legacyWarnings);
    }
    const headers = rawData[LEGACY_HEADER_ROW] || [];
    return parseLegacyLayout(rawData, headers, errors, warnings, legacyErrors, legacyWarnings, data);
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

function parseNewLayout(
  rawData: unknown[][],
  cols: NewLayoutColumns,
  errors: import("../file-processing-errors").FileProcessingError[],
  warnings: import("../file-processing-errors").FileProcessingError[],
  legacyErrors: string[],
  legacyWarnings: string[]
): FileProcessingResult {
  const data: ParsedRowData[] = [];
  // One aggregated row per franchisee — but the same franchisee can appear in
  // multiple monthly rows (col "חודש" / per-invoice rows). Aggregate per name.
  const franchiseeTotals = new Map<string, { netAmount: number; grossAmount: number; rowCount: number; firstRow: number }>();
  let skippedRows = 0;

  for (let rowIdx = cols.headerRowIdx + 1; rowIdx < rawData.length; rowIdx++) {
    const row = rawData[rowIdx];
    if (!row || row.length === 0) {
      skippedRows++;
      continue;
    }
    if (shouldSkipRow(row)) {
      skippedRows++;
      continue;
    }

    const franchisee = String(row[cols.franchiseeCol] || "").trim();
    if (!franchisee) {
      skippedRows++;
      continue;
    }

    const netAmount = cols.netCol === -1 ? 0 : parseNumericValue(row[cols.netCol]);
    const grossAmount = cols.grossCol === -1 ? 0 : parseNumericValue(row[cols.grossCol]);

    if (netAmount === 0 && grossAmount === 0) {
      warnings.push(
        createFileProcessingError("ZERO_AMOUNT", {
          rowNumber: rowIdx + 1,
          details: `Skipping zero-amount row for "${franchisee}"`,
        })
      );
      skippedRows++;
      continue;
    }

    const existing = franchiseeTotals.get(franchisee) || {
      netAmount: 0,
      grossAmount: 0,
      rowCount: 0,
      firstRow: rowIdx + 1,
    };
    existing.netAmount += netAmount;
    existing.grossAmount += grossAmount;
    existing.rowCount++;
    franchiseeTotals.set(franchisee, existing);
  }

  let totalNetAmount = 0;
  let totalGrossAmount = 0;
  let processed = 0;
  let rowNumber = 1;

  for (const [franchisee, totals] of franchiseeTotals.entries()) {
    // A file may carry only one of the two amount columns — derive the other
    // with 18% VAT (matches Kill Bill's standard markup).
    const netTotal = totals.netAmount > 0 ? totals.netAmount : totals.grossAmount / 1.18;

    if (netTotal <= 0) {
      warnings.push(
        createFileProcessingError("NEGATIVE_AMOUNT", {
          rowNumber: totals.firstRow,
          details: `Franchisee "${franchisee}" non-positive total: ${totals.netAmount}`,
          value: String(totals.netAmount),
        })
      );
      continue;
    }

    const net = roundAmount(netTotal);
    const gross = totals.grossAmount > 0 ? roundAmount(totals.grossAmount) : roundAmount(netTotal * 1.18);

    data.push({
      franchisee,
      date: null,
      grossAmount: gross,
      netAmount: net,
      originalAmount: gross,
      rowNumber: rowNumber++,
    });

    totalNetAmount += net;
    totalGrossAmount += gross;
    processed++;
  }

  if (processed === 0) {
    errors.push(
      createFileProcessingError("PARSE_ERROR", {
        details: "Could not extract any franchisee data from the file (new layout)",
      })
    );
    legacyErrors.push("Could not extract any franchisee data from the file (new layout)");
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
    processed,
    skippedRows,
    totalGrossAmount,
    totalNetAmount
  );
}

function parseLegacyLayout(
  rawData: unknown[][],
  headers: unknown[],
  errors: import("../file-processing-errors").FileProcessingError[],
  warnings: import("../file-processing-errors").FileProcessingError[],
  legacyErrors: string[],
  legacyWarnings: string[],
  data: ParsedRowData[]
): FileProcessingResult {
  const amountHeader = String(headers[LEGACY_AMOUNT_COL] || "");
  const franchiseeHeader = String(headers[LEGACY_FRANCHISEE_COL] || "");

  if (!amountHeader.includes("סכום")) {
    warnings.push(
      createFileProcessingError("PARSE_ERROR", {
        details: `Expected amount column header at A, found: "${amountHeader}"`,
      })
    );
  }
  if (!franchiseeHeader.includes("לקוח")) {
    warnings.push(
      createFileProcessingError("PARSE_ERROR", {
        details: `Expected franchisee column header at G, found: "${franchiseeHeader}"`,
      })
    );
  }

  const franchiseeTotals = new Map<string, { amount: number; rowCount: number; firstRow: number }>();
  let currentFranchisee: string | null = null;
  let skippedRows = 0;
  let totalRawRows = 0;

  for (let rowIdx = LEGACY_HEADER_ROW + 1; rowIdx < rawData.length; rowIdx++) {
    const row = rawData[rowIdx];
    if (!row || row.length === 0) {
      skippedRows++;
      continue;
    }

    if (shouldSkipRow(row)) {
      skippedRows++;
      continue;
    }

    totalRawRows++;

    const franchiseeName = String(row[LEGACY_FRANCHISEE_COL] || "").trim();
    const amount = parseNumericValue(row[LEGACY_AMOUNT_COL]);

    if (franchiseeName) {
      currentFranchisee = franchiseeName;
    }

    if (!currentFranchisee) {
      warnings.push(
        createFileProcessingError("EMPTY_FRANCHISEE_NAME", {
          rowNumber: rowIdx + 1,
          details: "Row found before any franchisee name",
        })
      );
      legacyWarnings.push(`Row ${rowIdx + 1}: No franchisee name found yet`);
      skippedRows++;
      continue;
    }

    if (amount === 0) {
      warnings.push(
        createFileProcessingError("ZERO_AMOUNT", {
          rowNumber: rowIdx + 1,
          details: `Skipping row with zero amount for "${currentFranchisee}"`,
        })
      );
      skippedRows++;
      continue;
    }

    const existing = franchiseeTotals.get(currentFranchisee) || {
      amount: 0,
      rowCount: 0,
      firstRow: rowIdx + 1,
    };
    existing.amount += amount;
    existing.rowCount++;
    franchiseeTotals.set(currentFranchisee, existing);
  }

  let totalAmount = 0;
  let processedFranchisees = 0;
  let rowNumber = 1;

  for (const [franchisee, amounts] of franchiseeTotals.entries()) {
    if (amounts.amount <= 0) {
      warnings.push(
        createFileProcessingError("NEGATIVE_AMOUNT", {
          rowNumber: amounts.firstRow,
          details: `Franchisee "${franchisee}" has non-positive total after aggregation: ${amounts.amount} (${amounts.rowCount} rows)`,
          value: String(amounts.amount),
        })
      );
      continue;
    }

    const netAmount = roundAmount(amounts.amount);
    const grossAmount = roundAmount(amounts.amount * 1.18);

    data.push({
      franchisee,
      date: null,
      grossAmount,
      netAmount,
      originalAmount: grossAmount,
      rowNumber: rowNumber++,
    });

    totalAmount += netAmount;
    processedFranchisees++;
  }

  if (processedFranchisees === 0) {
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
    processedFranchisees,
    skippedRows,
    roundAmount(totalAmount * 1.18),
    totalAmount
  );
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
      vatAdjusted: true,
    },
  };
}
