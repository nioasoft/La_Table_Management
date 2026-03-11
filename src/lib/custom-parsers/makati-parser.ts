/**
 * Custom parser for מקאטי (MAKATI) supplier files
 *
 * Partial VAT handling:
 *   The BKMV report includes VAT only on the taxable portion.
 *   Column C has taxable income (before VAT), Column D has exempt income,
 *   Column E has the total (C + D, no VAT anywhere).
 *
 *   netAmount  = Column E (total, no VAT)
 *   grossAmount = Column E + (Column C × vatRate)
 *
 *   This allows the reconciliation's partialVatMap to subtract
 *   only the taxable VAT from BKMV amounts:
 *     partialVat = grossAmount - netAmount = Column C × vatRate
 *     adjustedBKMV = bkmvAmount - partialVat ≈ Column E
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundAmount,
  ISRAEL_VAT_RATE,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";

// Column indices (0-based)
const FRANCHISEE_COL = 1; // Column B - שם החנות
const TAXABLE_COL = 2; // Column C - הכנסות חייבות לפני מע"מ
const TOTAL_COL = 4; // Column E - סהכ

// Skip keywords for totals row
const SKIP_KEYWORDS = ['סה"כ', "סהכ", "סה״כ", "סה\"כ"];

/**
 * Find the header row by looking for "שם החנות" in column B.
 * Returns the 0-based index, or -1 if not found.
 */
function findHeaderRow(rawData: unknown[][]): number {
  for (let i = 0; i < Math.min(rawData.length, 10); i++) {
    const row = rawData[i];
    if (!row) continue;
    const cellB = String(row[FRANCHISEE_COL] || "").trim();
    if (cellB.includes("שם החנות") || cellB.includes("שם הלקוח")) {
      return i;
    }
  }
  return -1;
}

export function parseMakatiFile(
  buffer: Buffer,
  vatRate: number = ISRAEL_VAT_RATE
): FileProcessingResult {
  const errors: import("../file-processing-errors").FileProcessingError[] = [];
  const warnings: import("../file-processing-errors").FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];

  try {
    const workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
    });

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

    // Auto-detect header row
    const headerRowIdx = findHeaderRow(rawData);
    const dataStartRow = headerRowIdx >= 0 ? headerRowIdx + 1 : 1;

    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let skippedRows = 0;
    let rowNumber = 1;

    for (let i = dataStartRow; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) {
        skippedRows++;
        continue;
      }

      const franchisee = String(row[FRANCHISEE_COL] || "").trim();

      // Skip empty rows
      if (!franchisee) {
        skippedRows++;
        continue;
      }

      // Skip totals row
      if (SKIP_KEYWORDS.some((kw) => franchisee.includes(kw))) {
        skippedRows++;
        continue;
      }

      // Parse amounts
      const taxableStr = String(row[TAXABLE_COL] || "0").trim();
      const totalStr = String(row[TOTAL_COL] || "0").trim();

      const taxableAmount =
        parseFloat(taxableStr.replace(/[,\s]/g, "")) || 0;
      const totalAmount = parseFloat(totalStr.replace(/[,\s]/g, "")) || 0;

      // Use Column E (total) as the net amount
      const netAmount = totalAmount;

      if (netAmount === 0) {
        warnings.push(
          createFileProcessingError("ZERO_AMOUNT", {
            rowNumber: i + 1,
            details: `Zero total for "${franchisee}"`,
          })
        );
        legacyWarnings.push(`Zero total for "${franchisee}"`);
        skippedRows++;
        continue;
      }

      // Partial VAT: gross includes VAT only on the taxable portion
      // grossAmount = netAmount + (taxableAmount × vatRate)
      // partialVat = grossAmount - netAmount = taxableAmount × vatRate
      const vatOnTaxable = taxableAmount * vatRate;
      const grossAmount = roundAmount(netAmount + vatOnTaxable);
      const roundedNet = roundAmount(netAmount);

      data.push({
        franchisee,
        date: null,
        grossAmount,
        netAmount: roundedNet,
        originalAmount: roundedNet,
        rowNumber: rowNumber++,
      });

      totalNetAmount += roundedNet;
      totalGrossAmount += grossAmount;
      processedRows++;
    }

    if (processedRows === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Could not extract any franchisee data from the file",
        })
      );
      legacyErrors.push("Could not extract any franchisee data from the file");
      return createResult(
        false,
        data,
        errors,
        warnings,
        legacyErrors,
        legacyWarnings,
        rawData.length
      );
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
    legacyErrors.push(
      error instanceof Error ? error.message : "Unknown error"
    );
    return createResult(
      false,
      data,
      errors,
      warnings,
      legacyErrors,
      legacyWarnings,
      0
    );
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
      hasPartialVat: true,
    },
  };
}
