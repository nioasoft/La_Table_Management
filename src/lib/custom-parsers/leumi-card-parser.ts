/**
 * Custom parser for לאומי קארד (LEUMI_CARD) annual refund files.
 *
 * File structure (single sheet "גיליון1") — an Excel PivotTable export:
 *   - A few leading blank columns, then a "Row Labels" / "תחשיב החזר" header.
 *   - "Row Labels" column = מספר עוסק (business ID, the franchisee join key).
 *   - "תחשיב החזר" column = the refund ALREADY computed by Leumi Card per
 *     business ID. Confirmed with the client (Asaf, 2026-06-03): this value is
 *     the final commission/refund, NOT a turnover base — the 0.15% rate is
 *     already baked in, and the figure is final (no VAT to add on top).
 *   - A trailing "Grand Total" row that must be skipped.
 *
 * Because the refund is pre-computed, the parser emits it as
 * `preCalculatedCommission` so downstream logic records it verbatim as the
 * commission instead of re-applying the supplier rate (see
 * calculateAndCreateCommission). Per the client's "F is final, no VAT"
 * decision we set netAmount = grossAmount = originalAmount = refund, so the
 * refund shows consistently across the UI and reports without any 1.18 gross-up.
 *
 * The file carries no per-row dates (it's an annual aggregate), so the parser
 * emits a DATES_NOT_EXTRACTED anomaly — the admin must confirm that the period
 * tagged on the upload page matches the report (Leumi Card runs an Apr–Mar
 * fiscal year). This mirrors the אראל אריזות parser.
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
} from "../file-processing-errors";
import { normalizeBusinessId } from "@/lib/business-id-utils";
import type { Anomaly } from "@/types/file-anomalies";

// Header labels that locate the two data columns within the pivot export.
const BUSINESS_ID_HEADER = "Row Labels";
const AMOUNT_HEADER = "תחשיב החזר";

// Labels that mark the trailing totals row (never a real franchisee).
const TOTALS_LABELS = ["grand total", "total", 'סה"כ', "סה״כ", "סהכ"];

/**
 * Annual aggregate — no per-row dates, so the admin must verify the period.
 */
const DATES_NOT_EXTRACTED_ANOMALY: Anomaly = {
  code: "DATES_NOT_EXTRACTED",
  severity: "warning",
  messageHe:
    "ה-parser של לאומי קארד אינו חולץ תאריכים מהקובץ — ודאי שהתקופה שתויגה בעמוד ההעלאה תואמת לתוכן הדוח.",
  details: {
    explanationHe:
      "הדוח של לאומי קארד הוא סיכום שנתי מצטבר (תחשיב החזר לפי מספר עוסק) ללא תאריכי שורה, ולכן המערכת אינה יכולה לאמת אוטומטית שהתקופה שנבחרה זהה לתקופת הדוח. לאומי קארד מתנהל לפי שנת כספים אפריל–מרץ. אם התקופה שגויה, יווצרו עמלות בתקופה הלא נכונה (וניקוי דורש מחיקה ידנית של ה-commissions).",
  },
  suggestedActions: [
    {
      type: "acknowledge_only",
      labelHe: "אישרתי שהתקופה נכונה",
    },
  ],
};

function isTotalsLabel(value: string): boolean {
  const normalized = value.trim().toLowerCase();
  return TOTALS_LABELS.some((label) => normalized === label);
}

/**
 * Parse a refund amount that may arrive as a number or a "₪1,234.56" string.
 */
function parseAmount(raw: unknown): number {
  if (typeof raw === "number") return raw;
  const parsed = parseFloat(String(raw ?? "").replace(/[₪,\s]/g, ""));
  return Number.isNaN(parsed) ? NaN : parsed;
}

/**
 * Parse a לאומי קארד annual refund file.
 */
export function parseLeumiCardFile(buffer: Buffer): FileProcessingResult {
  const errors: FileProcessingError[] = [];
  const warnings: FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];

  try {
    const workbook = XLSX.read(buffer, { type: "buffer" });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) {
      errors.push(
        createFileProcessingError("NO_WORKSHEETS", {
          details: "Workbook contains no sheets",
        })
      );
      legacyErrors.push("Workbook contains no sheets");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    const sheet = workbook.Sheets[sheetName];
    const rows: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: "",
    });

    // Locate the header row + the two columns by their labels (robust to the
    // pivot's leading blank columns / row offset).
    let headerRowIdx = -1;
    let idCol = -1;
    let amountCol = -1;
    for (let i = 0; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;
      for (let c = 0; c < row.length; c++) {
        const cell = String(row[c] ?? "").trim();
        if (cell === BUSINESS_ID_HEADER) idCol = c;
        if (cell === AMOUNT_HEADER) amountCol = c;
      }
      if (idCol >= 0 && amountCol >= 0) {
        headerRowIdx = i;
        break;
      }
      // Reset partial matches so the labels must appear on the same row.
      idCol = -1;
      amountCol = -1;
    }

    if (headerRowIdx === -1) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: `Could not find the header row. Expected a row containing "${BUSINESS_ID_HEADER}" and "${AMOUNT_HEADER}".`,
        })
      );
      legacyErrors.push("Could not find Leumi Card header row");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    let totalAmount = 0;
    let processedRows = 0;
    let skippedRows = 0;
    let dataRows = 0;
    let rowNumber = 1;

    for (let i = headerRowIdx + 1; i < rows.length; i++) {
      const row = rows[i];
      if (!row) continue;

      const rawId = String(row[idCol] ?? "").trim();
      if (rawId === "") continue;

      // Stop on / skip the trailing Grand Total row.
      if (isTotalsLabel(rawId)) {
        skippedRows++;
        continue;
      }

      dataRows++;

      const businessId = normalizeBusinessId(rawId);
      if (!businessId) {
        skippedRows++;
        continue;
      }

      const amount = parseAmount(row[amountCol]);
      if (Number.isNaN(amount)) {
        skippedRows++;
        continue;
      }

      const refund = roundAmount(amount);
      // Drop pivot noise rows that round to ₪0 (e.g. a 0.0032 residual) — they
      // would otherwise create meaningless zero commissions.
      if (refund === 0) {
        skippedRows++;
        continue;
      }

      // The refund is the final commission: record it verbatim and mirror it
      // into net/gross so no rate or VAT is re-applied downstream.
      data.push({
        franchisee: businessId,
        franchiseeId: businessId,
        date: null,
        grossAmount: refund,
        netAmount: refund,
        originalAmount: refund,
        preCalculatedCommission: refund,
        rowNumber: rowNumber++,
      });

      totalAmount += refund;
      processedRows++;
    }

    if (processedRows === 0) {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details:
            "Could not extract any franchisee refunds from the file. Check that the report has a 'Row Labels' (מספר עוסק) column and a 'תחשיב החזר' amount column.",
        })
      );
      legacyErrors.push("Could not extract any franchisee refunds from the file");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, dataRows);
    }

    return createResult(
      true,
      data,
      errors,
      warnings,
      legacyErrors,
      legacyWarnings,
      dataRows,
      processedRows,
      skippedRows,
      roundAmount(totalAmount),
      roundAmount(totalAmount),
      [DATES_NOT_EXTRACTED_ANOMALY]
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
  errors: FileProcessingError[],
  warnings: FileProcessingError[],
  legacyErrors: string[],
  legacyWarnings: string[],
  totalRows: number,
  processedRows = 0,
  skippedRows = 0,
  totalGrossAmount = 0,
  totalNetAmount = 0,
  anomalies: Anomaly[] = []
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
    anomalies: anomalies.length > 0 ? anomalies : undefined,
  };
}
