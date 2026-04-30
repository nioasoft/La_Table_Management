/**
 * Custom parser for מדג (MADAG) supplier files
 *
 * Two layouts supported (auto-detected from buffer signature):
 *
 * LEGACY layout (xlsx with embedded customer headers):
 *   - Row 0: Title
 *   - Row 1: Date range
 *   - Row 2: Headers (מק"ט, תאור מוצר, מטבע, הכנסה, יח', כמות, סה"כ חיוב לקוח בגין עמלות)
 *   - Row 3+: Customer header "מס. לקוח: XXXXX, שם לקוח: <name>" followed by product rows.
 *   - Sale amount per product row in column 3 ("הכנסה"), aggregated per customer.
 *
 * NEW layout (Windows-1255 CSV, per-product per-customer rows):
 *   - Row 0: Headers ["תקופה", "שם לקוח", "מקט", "שם פריט", "כמות", "מחיר", "סהכ לפריט"]
 *   - Row 1+: Each row has the customer name directly in col B and the
 *     per-item total in col G ("סהכ לפריט"). Aggregate by customer name.
 *
 * Commission rate: Madag uses a fixed 10% configured at the supplier level —
 * we only need the sale amount for cross-reference.
 */

import * as XLSX from "xlsx";
import iconv from "iconv-lite";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundAmount,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

const VAT_RATE = 0.18;

// LEGACY: customer name embedded in cell text
const CUSTOMER_NAME_REGEX = /שם לקוח[:\s]*([^\n,]+)/;

// NEW layout column indices
const NEW_PERIOD_COL = 0;
const NEW_FRANCHISEE_COL = 1;
const NEW_PRODUCT_NAME_COL = 3;
const NEW_TOTAL_COL = 6;

const NEW_HEADER_PERIOD = "תקופה";
const NEW_HEADER_FRANCHISEE = "שם לקוח";
const NEW_HEADER_TOTAL_KEYWORDS = ["סהכ לפריט", 'סה"כ לפריט', "סה״כ לפריט"];

/**
 * Detect new flat-CSV layout: file is text-decodable as Windows-1255 and the
 * first row contains the expected header columns.
 */
function detectNewLayout(buffer: Buffer): boolean {
  try {
    const decoded = iconv.decode(buffer, "windows-1255");
    // CSV text files are short on binary noise; reject if too many control chars
    // (which would indicate this is actually a binary xlsx).
    const sample = decoded.slice(0, 1000);
    const firstLine = sample.split(/\r?\n/)[0] || "";
    if (!firstLine.includes(NEW_HEADER_PERIOD)) return false;
    if (!firstLine.includes(NEW_HEADER_FRANCHISEE)) return false;
    if (!NEW_HEADER_TOTAL_KEYWORDS.some((kw) => firstLine.includes(kw))) return false;
    return true;
  } catch {
    return false;
  }
}

export function parseMadagFile(buffer: Buffer): FileProcessingResult {
  if (detectNewLayout(buffer)) {
    return parseNewLayoutCsv(buffer);
  }
  return parseLegacyXlsx(buffer);
}

function parseNewLayoutCsv(buffer: Buffer): FileProcessingResult {
  const errors: import("../file-processing-errors").FileProcessingError[] = [];
  const warnings: import("../file-processing-errors").FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];

  try {
    const decoded = iconv.decode(buffer, "windows-1255");
    const workbook = XLSX.read(decoded, { type: "string", cellDates: true });
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

    if (!rawData || rawData.length < 2) {
      errors.push(createFileProcessingError("FILE_EMPTY"));
      legacyErrors.push("File is empty or too short");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    // Aggregate sale totals by customer
    const customerAmounts = new Map<string, { amount: number; firstRow: number }>();
    const uniqueProducts = new Set<string>();
    let skippedRows = 0;

    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) {
        skippedRows++;
        continue;
      }

      const customer = String(row[NEW_FRANCHISEE_COL] || "").trim();
      const totalStr = String(row[NEW_TOTAL_COL] || "").trim();
      const productName = String(row[NEW_PRODUCT_NAME_COL] || "").trim();

      if (productName) uniqueProducts.add(productName);

      // Skip summary rows
      const joined = row.map((c) => String(c || "")).join(" ");
      if (joined.includes('סה"כ') || joined.includes("סה״כ") || joined.includes("סהכ ")) {
        skippedRows++;
        continue;
      }

      if (!customer) {
        skippedRows++;
        continue;
      }

      const total = parseFloat(totalStr.replace(/[,₪\s]/g, ""));
      if (isNaN(total) || total === 0) {
        skippedRows++;
        continue;
      }

      const existing = customerAmounts.get(customer) || { amount: 0, firstRow: i + 1 };
      existing.amount += total;
      customerAmounts.set(customer, existing);
    }

    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let rowNumber = 1;

    for (const [customer, totals] of customerAmounts.entries()) {
      if (totals.amount <= 0) {
        skippedRows++;
        continue;
      }

      const netAmount = roundAmount(totals.amount);
      const grossAmount = roundAmount(totals.amount * (1 + VAT_RATE));

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
          details: "Could not extract any customer data from the new-layout file",
        })
      );
      legacyErrors.push("Could not extract any customer data from the new-layout file");
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
      processedRows,
      skippedRows,
      totalGrossAmount,
      totalNetAmount
    );

    if (uniqueProducts.size > 0) {
      result.summary.extractedProducts = [...uniqueProducts];
    }

    return result;
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

function parseLegacyXlsx(buffer: Buffer): FileProcessingResult {
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
