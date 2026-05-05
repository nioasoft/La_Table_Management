/**
 * Custom parser for מדג (MADAG) supplier files
 *
 * Two layouts coexist in the wild:
 *
 * LAYOUT A — Embedded customer headers (legacy "PRID*.tmp" sheet):
 *   - Row 0: Title ("מכירות ללקוח לפי מוצר (חשבוניות)")
 *   - Row 1: Date range
 *   - Row 2: Headers (מק"ט, תאור מוצר, מטבע, הכנסה, יח', כמות, סה"כ חיוב לקוח בגין עמלות)
 *   - Row 3+: Customer header "מס. לקוח: XXXXX, שם לקוח: <name>" followed by
 *     product rows. Sale amount per product row in column 3 ("הכנסה").
 *
 * LAYOUT B — Flat per-product table (new, sheet "DataSheet"):
 *   - Row 0: column headers — מס. לקוח, שם לקוח, מק'ט, תאור מוצר, כמות, יח', הכנסה, מטבע
 *   - Rows 1..N-3: one row per product per customer; aggregate הכנסה by שם לקוח.
 *   - Trailing rows (after the data) include a grand-total row (תאור מוצר=סה"כ),
 *     a "10% עמלה" pre-calculated commission row, and a
 *     "סה"כ לחיוב כולל מע"מ" invoice-total row — all skipped because they
 *     have an empty שם לקוח cell.
 *
 * The parser auto-detects which layout to use from row 0.
 *
 * Note: a "ריכוז מכירות ללקוחות" compact layout used to live here too — that
 * format actually belongs to AREL_PACKAGING and is handled by
 * arel-arizot-parser.ts. Do not re-add it here; doing so silently mis-attributes
 * AREL sales as MADAG commissions.
 *
 * Commission rate: Madag uses a fixed 10% configured at the supplier level —
 * we only need the sale amount for cross-reference.
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundAmount,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

const VAT_RATE = 0.18;

// Customer name embedded in cell text
const CUSTOMER_NAME_REGEX = /שם לקוח[:\s]*([^\n,]+)/;

export function parseMadagFile(buffer: Buffer): FileProcessingResult {
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

    if (!rawData || rawData.length === 0) {
      errors.push(createFileProcessingError("FILE_EMPTY"));
      legacyErrors.push("File is empty");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    if (isFlatLayout(rawData[0])) {
      return parseFlatCustomerLayout(rawData, data, errors, warnings, legacyErrors, legacyWarnings);
    }

    return parseEmbeddedCustomerLayout(rawData, data, errors, warnings, legacyErrors, legacyWarnings);
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

function normaliseHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/[״"׳']/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function findHeaderColumn(header: unknown[], target: string): number {
  const normTarget = normaliseHeader(target);
  for (let i = 0; i < header.length; i++) {
    if (normaliseHeader(header[i]) === normTarget) return i;
  }
  return -1;
}

/**
 * The flat layout is identified by row 0 containing both "שם לקוח" (customer
 * name) and "הכנסה" (revenue) as column headers.
 */
function isFlatLayout(headerRow: unknown[] | undefined): boolean {
  if (!headerRow) return false;
  const hasCustomerName = findHeaderColumn(headerRow, "שם לקוח") >= 0;
  const hasRevenue = findHeaderColumn(headerRow, "הכנסה") >= 0;
  return hasCustomerName && hasRevenue;
}

function parseFlatCustomerLayout(
  rawData: unknown[][],
  data: ParsedRowData[],
  errors: import("../file-processing-errors").FileProcessingError[],
  warnings: import("../file-processing-errors").FileProcessingError[],
  legacyErrors: string[],
  legacyWarnings: string[]
): FileProcessingResult {
  const header = rawData[0];
  const customerNameCol = findHeaderColumn(header, "שם לקוח");
  const revenueCol = findHeaderColumn(header, "הכנסה");

  if (customerNameCol < 0 || revenueCol < 0) {
    errors.push(
      createFileProcessingError("PARSE_ERROR", {
        details:
          'Flat layout detected but required headers are missing ("שם לקוח" / "הכנסה")',
      })
    );
    legacyErrors.push("Required headers missing in flat layout");
    return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, rawData.length);
  }

  const customerAmounts: Map<string, number> = new Map();
  let skippedRows = 0;

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) {
      skippedRows++;
      continue;
    }

    const customer = String(row[customerNameCol] ?? "").trim();
    if (!customer) {
      // Trailing summary rows (סה"כ, 10% עמלה, סה"כ לחיוב כולל מע"מ) have
      // an empty customer-name cell — skip them.
      skippedRows++;
      continue;
    }

    if (
      customer.includes('סה"כ') ||
      customer.includes("סה״כ") ||
      customer.includes("סהכ") ||
      customer.includes("סיכום") ||
      customer.includes("עמלה")
    ) {
      skippedRows++;
      continue;
    }

    const saleValue = row[revenueCol];
    if (saleValue === null || saleValue === undefined || saleValue === "") {
      skippedRows++;
      continue;
    }
    const sale = parseFloat(String(saleValue).replace(/[,₪\s]/g, ""));
    if (!isFinite(sale)) {
      skippedRows++;
      continue;
    }

    customerAmounts.set(customer, (customerAmounts.get(customer) ?? 0) + sale);
  }

  let processedRows = 0;
  let totalGrossAmount = 0;
  let totalNetAmount = 0;
  let rowNumber = 1;

  for (const [customer, saleAmount] of customerAmounts.entries()) {
    if (saleAmount <= 0) {
      skippedRows++;
      continue;
    }

    const netAmount = roundAmount(saleAmount);
    const grossAmount = roundAmount(saleAmount * (1 + VAT_RATE));

    data.push({
      franchisee: customer,
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
        details: "Could not extract any customer data from the flat layout",
      })
    );
    legacyErrors.push("Could not extract any customer data from the flat layout");
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
}

function parseEmbeddedCustomerLayout(
  rawData: unknown[][],
  data: ParsedRowData[],
  errors: import("../file-processing-errors").FileProcessingError[],
  warnings: import("../file-processing-errors").FileProcessingError[],
  legacyErrors: string[],
  legacyWarnings: string[]
): FileProcessingResult {
  let currentCustomer = "";
  let totalGrossAmount = 0;
  let totalNetAmount = 0;
  let processedRows = 0;
  let skippedRows = 0;

  const customerAmounts: Map<string, number> = new Map();

  for (let i = 3; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row || row.length === 0) {
      skippedRows++;
      continue;
    }

    const firstCell = String(row[0] || "").trim();

    const customerMatch = firstCell.match(CUSTOMER_NAME_REGEX);
    if (customerMatch) {
      currentCustomer = customerMatch[1].trim();
      skippedRows++;
      continue;
    }

    const rowStr = row.map((c) => String(c || "")).join(" ");
    if (rowStr.includes('סה"כ') || rowStr.includes("סה״כ") || rowStr.includes("סהכ")) {
      skippedRows++;
      continue;
    }

    if (!currentCustomer) {
      skippedRows++;
      continue;
    }

    const existing = customerAmounts.get(currentCustomer) || 0;

    const saleValue = row[3];
    if (saleValue !== null && saleValue !== undefined && saleValue !== "") {
      const sale = parseFloat(String(saleValue).replace(/[,₪\s]/g, ""));
      if (!isNaN(sale)) {
        customerAmounts.set(currentCustomer, existing + sale);
      }
    }
  }

  let rowNumber = 1;
  for (const [customer, saleAmount] of customerAmounts.entries()) {
    if (saleAmount <= 0) {
      skippedRows++;
      continue;
    }

    if (customer.includes("סה״כ") || customer.includes("סהכ") || customer.includes("סיכום")) {
      skippedRows++;
      continue;
    }

    const netAmount = roundAmount(saleAmount);
    const grossAmount = roundAmount(saleAmount * (1 + VAT_RATE));

    data.push({
      franchisee: customer,
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
        details: "Could not extract any customer data from the file",
      })
    );
    legacyErrors.push("Could not extract any customer data from the file");
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
