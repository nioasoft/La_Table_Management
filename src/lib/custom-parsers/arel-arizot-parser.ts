/**
 * Custom parser for אראל אריזות (AREL_ARIZOT) supplier files
 *
 * Two layouts supported (auto-detected):
 *
 * LEGACY layout (parameter headers + alternating data rows):
 *   - Rows 0-11: Filter/parameter headers
 *   - Row 12: Column headers
 *     - Col 0: סכום כולל מע"מ (gross amount)
 *     - Col 3: סכום לא כולל מע"מ (net amount)
 *     - Col 8: שם לקוח (customer name)
 *     - Col 11: כרטיס לקוח (customer ID)
 *   - Rows 14, 16, 18, ...: Data rows (every other row has data)
 *   - Row with "סה"כ מכירות" in col 4: Total row (stop)
 *
 * NEW layout ("ריכוז מכירות ללקוחות" — same compact shape MADAG ships):
 *   - Row 0: Filter info
 *   - Row 1: Title + headers (contains "ריכוז מכירות ללקוחות")
 *   - Row 2+: One aggregated row per customer
 *       col B (1): gross amount with VAT
 *       col C (2): customer name
 *       col D (3): customer card / ID
 *   - Footer rows: "סה"כ מכירות" / "מערכת תוכנה" (skip).
 *   - VAT: amount is GROSS; back-calculate net = gross / 1.18.
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundAmount,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

const VAT_RATE = 0.18;

// LEGACY column indices
const LEGACY_GROSS_AMOUNT_COL = 0;
const LEGACY_NET_AMOUNT_COL = 3;
const LEGACY_CUSTOMER_NAME_COL = 8;

// NEW (compact) column indices
const NEW_GROSS_COL = 1;
const NEW_FRANCHISEE_COL = 2;

const NEW_LAYOUT_TITLE = "ריכוז מכירות ללקוחות";
const NEW_SKIP_KEYWORDS = ['סה"כ', "סה״כ", "סהכ", "מערכת תוכנה"];
const COMPACT_TITLE_SCAN_ROWS = 5;
const COMPACT_DATA_SCAN_ROWS = 8;

/**
 * Detect compact "ריכוז מכירות" layout. Returns the row index where data
 * begins, or null if the file is not in compact layout.
 *
 * The title is scanned across the first {@link COMPACT_TITLE_SCAN_ROWS} rows
 * (rather than locked to row 1), and the first data row is detected
 * dynamically by walking forward until a row has a customer name at col C
 * and a positive numeric gross at col B. This tolerates layout drift caused
 * by browser-side .xls→.xlsx re-encoding (SheetJS in the browser writes
 * slightly different XLSX bytes than Node, occasionally inserting/shifting
 * a header row).
 */
function detectCompactLayout(rawData: unknown[][]): { dataStartRow: number } | null {
  if (rawData.length < 3) return null;

  let titleRow = -1;
  for (let i = 0; i < Math.min(COMPACT_TITLE_SCAN_ROWS, rawData.length); i++) {
    const joined = (rawData[i] || []).map((c) => String(c || "")).join(" ");
    if (joined.includes(NEW_LAYOUT_TITLE)) {
      titleRow = i;
      break;
    }
  }
  if (titleRow === -1) return null;

  const scanLimit = Math.min(rawData.length, titleRow + 1 + COMPACT_DATA_SCAN_ROWS);
  for (let i = titleRow + 1; i < scanLimit; i++) {
    const row = rawData[i] || [];
    const name = String(row[NEW_FRANCHISEE_COL] || "").trim();
    if (!name) continue;
    if (NEW_SKIP_KEYWORDS.some((kw) => name.includes(kw))) continue;
    const grossStr = String(row[NEW_GROSS_COL] || "").trim();
    const gross = parseFloat(grossStr.replace(/[,\s₪]/g, ""));
    if (!isNaN(gross) && gross > 0) {
      return { dataStartRow: i };
    }
  }

  return null;
}

export function parseArelArizotFile(buffer: Buffer): FileProcessingResult {
  const errors: import("../file-processing-errors").FileProcessingError[] = [];
  const warnings: import("../file-processing-errors").FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];

  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });

    // Find the data sheet (usually "ריכוז מכירות ללקוחות" or first sheet)
    let sheetName = workbook.SheetNames.find((name) => name.includes("ריכוז מכירות"));
    if (!sheetName) {
      sheetName = workbook.SheetNames[0];
    }

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

    if (!rawData || rawData.length === 0) {
      errors.push(createFileProcessingError("FILE_EMPTY"));
      legacyErrors.push("File is empty");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    const compact = detectCompactLayout(rawData);
    console.log("[AREL_PARSER_V2] rows=" + rawData.length +
      " row0=" + JSON.stringify((rawData[0] || []).slice(0, 8)) +
      " row1=" + JSON.stringify((rawData[1] || []).slice(0, 8)) +
      " row2=" + JSON.stringify((rawData[2] || []).slice(0, 8)) +
      " compact=" + JSON.stringify(compact));
    if (compact) {
      return parseCompactLayout(
        rawData,
        compact.dataStartRow,
        errors,
        warnings,
        legacyErrors,
        legacyWarnings
      );
    }
    return parseLegacyLayout(rawData, data, errors, warnings, legacyErrors, legacyWarnings);
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

function parseCompactLayout(
  rawData: unknown[][],
  dataStartRow: number,
  errors: import("../file-processing-errors").FileProcessingError[],
  warnings: import("../file-processing-errors").FileProcessingError[],
  legacyErrors: string[],
  legacyWarnings: string[]
): FileProcessingResult {
  const data: ParsedRowData[] = [];
  let totalGrossAmount = 0;
  let totalNetAmount = 0;
  let processed = 0;
  let skipped = 0;
  let rowNumber = 1;

  for (let i = dataStartRow; i < rawData.length; i++) {
    const row = rawData[i] || [];
    if (row.length === 0) {
      skipped++;
      continue;
    }

    const franchisee = String(row[NEW_FRANCHISEE_COL] || "").trim();
    const grossStr = String(row[NEW_GROSS_COL] || "").trim();

    const joined = row.map((c) => String(c || "")).join(" ");
    if (NEW_SKIP_KEYWORDS.some((kw) => joined.includes(kw))) {
      skipped++;
      continue;
    }

    if (!franchisee || !grossStr) {
      skipped++;
      continue;
    }

    const gross = parseFloat(grossStr.replace(/[,\s₪]/g, ""));
    if (isNaN(gross) || gross <= 0) {
      skipped++;
      continue;
    }

    const grossRounded = roundAmount(gross);
    const netRounded = roundAmount(gross / (1 + VAT_RATE));

    data.push({
      franchisee,
      date: null,
      grossAmount: grossRounded,
      netAmount: netRounded,
      originalAmount: grossRounded,
      rowNumber: rowNumber++,
    });

    totalGrossAmount += grossRounded;
    totalNetAmount += netRounded;
    processed++;
  }

  if (processed === 0) {
    errors.push(
      createFileProcessingError("PARSE_ERROR", {
        details: "Could not extract any franchisee data from the compact-layout file [compact-v2]",
      })
    );
    legacyErrors.push("Could not extract any franchisee data from the compact-layout file [compact-v2]");
    return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rawData.length);
  }

  const result = createResult(
    true,
    data,
    errors,
    warnings,
    legacyErrors,
    legacyWarnings,
    rawData.length,
    processed,
    skipped,
    totalGrossAmount,
    totalNetAmount
  );
  result.summary.vatAdjusted = true;
  return result;
}

function parseLegacyLayout(
  rawData: unknown[][],
  data: ParsedRowData[],
  errors: import("../file-processing-errors").FileProcessingError[],
  warnings: import("../file-processing-errors").FileProcessingError[],
  legacyErrors: string[],
  legacyWarnings: string[]
): FileProcessingResult {
  if (rawData.length < 14) {
    errors.push(createFileProcessingError("FILE_EMPTY"));
    legacyErrors.push("File is empty or too short");
    return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
  }

  const franchiseeAmounts: Map<string, { net: number; gross: number }> = new Map();

  // Start from row 14 (first data row after headers)
  for (let i = 14; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row) continue;

    const col4 = String(row[4] || "").trim();
    if (col4.includes('סה"כ') || col4.includes("סהכ")) {
      break;
    }

    const grossAmountCell = String(row[LEGACY_GROSS_AMOUNT_COL] || "").trim();
    const netAmountCell = String(row[LEGACY_NET_AMOUNT_COL] || "").trim();
    const customerCell = String(row[LEGACY_CUSTOMER_NAME_COL] || "").trim();

    if (!customerCell && !grossAmountCell) continue;

    const grossAmount = parseFloat(grossAmountCell.replace(/[,\s]/g, ""));
    const netAmount = parseFloat(netAmountCell.replace(/[,\s]/g, ""));

    if (customerCell && !isNaN(netAmount) && netAmount !== 0) {
      const existing = franchiseeAmounts.get(customerCell) || { net: 0, gross: 0 };
      franchiseeAmounts.set(customerCell, {
        net: existing.net + netAmount,
        gross: existing.gross + (isNaN(grossAmount) ? netAmount * (1 + VAT_RATE) : grossAmount),
      });
    }
  }

  let totalGrossAmount = 0;
  let totalNetAmount = 0;
  let processedRows = 0;
  let rowNumber = 1;

  for (const [franchisee, amounts] of franchiseeAmounts.entries()) {
    if (amounts.net <= 0) continue;

    const netAmount = roundAmount(amounts.net);
    const grossAmount = roundAmount(amounts.gross);

    data.push({
      franchisee,
      date: null,
      grossAmount,
      netAmount,
      originalAmount: netAmount,
      rowNumber: rowNumber++,
    });

    totalNetAmount += netAmount;
    totalGrossAmount += grossAmount;
    processedRows++;
  }

  if (processedRows === 0) {
    errors.push(
      createFileProcessingError("PARSE_ERROR", {
        details: "Could not extract any franchisee data from the file [legacy-v2]",
      })
    );
    legacyErrors.push("Could not extract any franchisee data from the file [legacy-v2]");
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
    rawData.length - processedRows,
    totalGrossAmount,
    totalNetAmount
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
      vatAdjusted: false,
    },
  };
}
