/**
 * Custom parser for מקאטי (MAKATI) supplier files
 *
 * Columns (stable across both known exports):
 *   B (1) שם החנות / שם חשבון — franchisee name
 *   C (2) הכנסות חייבות לפני מע"מ — taxable income (before VAT)
 *   D (3) הכנסות פטורות — exempt income
 *   E (4) סה"כ — total
 *
 * netAmount = C + D — NOT column E. In the original export E was exactly
 * C + D, but the Q2-2026 "דוח עמלות רשת" export bakes VAT on the taxable
 * portion into E (at the supplier's stale 17% rate: E = C×1.17 + D), and
 * commission is never charged on VAT. Falls back to E when C and D are
 * both empty.
 *
 * Sign convention: the Q2-2026 export is a bookkeeping credit-side report —
 * EVERY amount arrives negative. When all rows are negative the parser flips
 * the whole file to positive and surfaces a NEGATIVE_AMOUNTS anomaly (real
 * incident: Q2-2026 commissions synced negative into the invoice report).
 * Isolated negative rows in an otherwise positive file are kept as credits.
 *
 * Partial VAT handling:
 *   grossAmount = netAmount + (Column C × vatRate)
 *   This allows the reconciliation's partialVatMap to subtract
 *   only the taxable VAT from BKMV amounts:
 *     partialVat = grossAmount - netAmount = Column C × vatRate
 */

import * as XLSX from "xlsx";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundAmount,
  ISRAEL_VAT_RATE,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";
import type { Anomaly } from "@/types/file-anomalies";

// Column indices (0-based)
const FRANCHISEE_COL = 1; // Column B - שם החנות / שם חשבון
const TAXABLE_COL = 2; // Column C - הכנסות חייבות לפני מע"מ
const EXEMPT_COL = 3; // Column D - הכנסות פטורות
const TOTAL_COL = 4; // Column E - סהכ

// Skip keywords for totals row
const SKIP_KEYWORDS = ['סה"כ', "סהכ", "סה״כ", "סה\"כ"];

/**
 * Find the header row by looking for the name-column header in column B.
 * Returns the 0-based index, or -1 if not found.
 */
function findHeaderRow(rawData: unknown[][]): number {
  for (let i = 0; i < Math.min(rawData.length, 10); i++) {
    const row = rawData[i];
    if (!row) continue;
    const cellB = String(row[FRANCHISEE_COL] || "").trim();
    if (
      cellB.includes("שם החנות") ||
      cellB.includes("שם הלקוח") ||
      cellB.includes("שם חשבון")
    ) {
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

    // First pass: collect rows so the credit-side sign flip can be decided
    // over the whole file, not per row.
    const parsedRows: Array<{ franchisee: string; taxable: number; net: number }> = [];

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
      const exemptStr = String(row[EXEMPT_COL] || "0").trim();
      const totalStr = String(row[TOTAL_COL] || "0").trim();

      const taxableAmount = parseFloat(taxableStr.replace(/[,\s]/g, "")) || 0;
      const exemptAmount = parseFloat(exemptStr.replace(/[,\s]/g, "")) || 0;
      const totalAmount = parseFloat(totalStr.replace(/[,\s]/g, "")) || 0;

      // Commission base = taxable + exempt income, never column E — the
      // Q2-2026 export bakes VAT-on-taxable into E. Fall back to E only
      // when C and D are both empty.
      const netAmount =
        taxableAmount !== 0 || exemptAmount !== 0
          ? taxableAmount + exemptAmount
          : totalAmount;

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

      parsedRows.push({ franchisee, taxable: taxableAmount, net: netAmount });
    }

    // Credit-side export: every amount negative → flip the whole file.
    const creditSideExport =
      parsedRows.length > 0 && parsedRows.every((r) => r.net < 0);
    const sign = creditSideExport ? -1 : 1;
    if (creditSideExport) {
      legacyWarnings.push(
        "All amounts in file are negative (credit-side export) — converted to positive"
      );
    }

    let rowNumber = 1;
    for (const parsed of parsedRows) {
      const net = parsed.net * sign;
      const taxable = parsed.taxable * sign;

      // Partial VAT: gross includes VAT only on the taxable portion
      // grossAmount = netAmount + (taxableAmount × vatRate)
      // partialVat = grossAmount - netAmount = taxableAmount × vatRate
      const grossAmount = roundAmount(net + taxable * vatRate);
      const roundedNet = roundAmount(net);

      data.push({
        franchisee: parsed.franchisee,
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

    if (creditSideExport) {
      const anomaly: Anomaly = {
        code: "NEGATIVE_AMOUNTS",
        severity: "warning",
        messageHe:
          "כל הסכומים בקובץ מקטי שליליים (ייצוא הנהלת-חשבונות בצד זכות) — הוסבו אוטומטית לחיוביים.",
        details: {
          explanationHe:
            'הדוח החדש של מקטי ("דוח עמלות רשת") מיוצא מהנהלת החשבונות עם יתרות זכות, ולכן כל ההכנסות מופיעות במינוס. המערכת הפכה את הסימן לכל השורות. שימו לב: עמודת סה"כ בקובץ כוללת מע"מ על החלק החייב — בסיס העמלה חושב מסכום החייבות + הפטורות בלבד, ולכן הסכום במערכת נמוך מסה"כ בקובץ.',
        },
        suggestedActions: [
          {
            type: "acknowledge_only",
            labelHe: "הבנתי, הסכומים הוסבו לחיוביים",
          },
        ],
      };
      return { ...result, anomalies: [anomaly] };
    }

    return result;
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
