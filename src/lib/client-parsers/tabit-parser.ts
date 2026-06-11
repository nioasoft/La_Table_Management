/**
 * Tabit POS pivot table parser
 *
 * Parses Excel exports from Tabit POS system. The file is a pivot table.
 * TWO layouts exist, depending on whether the export was grouped by period:
 *
 * Layout A (with "שנה וחודש" grouping):
 * - Row 0: Payment method names as column headers (from col C)
 * - Row 1: Sub-headers: "שנה וחודש" (col A), "סניף" (col B), "סה"כ תקבולים"…
 * - Data rows: period string, branch name, amounts per payment method
 *
 * Layout B (no period grouping — e.g. Reut's Mina Tomai export 2026-06-11):
 * - Row 0: Payment method names as column headers (from col B)
 * - Row 1: Sub-headers: "סניף" (col A), "סה"כ תקבולים"…
 * - Data rows: branch name, amounts. NO period in the file — the caller's
 *   input period is used (processTabitUpload fallback).
 *
 * The branch column is therefore LOCATED by finding "סניף" in the
 * sub-header row, not assumed to be col B. Before this fix, Layout B files
 * were read with col B (the first payment amount) as the "branch name" —
 * "סניפים לא מזוהים: 118, 1065, 2076, 148" were GIFT CARD amounts.
 *
 * Common to both layouts:
 * - Total/summary rows (branch col = "Total") — skipped
 * - Filter metadata rows at the end — skipped
 */

import * as XLSX from "xlsx";
import type { TabitProcessingResult, TabitBranchRow } from "./types";

// ============================================================================
// HEBREW MONTH MAPPING
// ============================================================================

const HEBREW_MONTHS: Record<string, number> = {
  ינואר: 1,
  פברואר: 2,
  מרץ: 3,
  אפריל: 4,
  מאי: 5,
  יוני: 6,
  יולי: 7,
  אוגוסט: 8,
  ספטמבר: 9,
  אוקטובר: 10,
  נובמבר: 11,
  דצמבר: 12,
};

/**
 * Parse a Hebrew period string like "2026 פברואר" into { month, year }
 */
function parseHebrewPeriod(
  periodStr: string
): { month: number; year: number } | null {
  if (!periodStr || typeof periodStr !== "string") return null;

  const trimmed = periodStr.trim();

  // Pattern: "YYYY monthName" or "monthName YYYY"
  for (const [name, month] of Object.entries(HEBREW_MONTHS)) {
    if (trimmed.includes(name)) {
      const yearMatch = trimmed.match(/(\d{4})/);
      if (yearMatch) {
        return { month, year: parseInt(yearMatch[1], 10) };
      }
    }
  }

  return null;
}

// ============================================================================
// PARSER
// ============================================================================

/**
 * Parse a Tabit POS Excel pivot table export.
 * Returns the full matrix of branches × payment methods.
 */
export async function parseTabitFile(
  buffer: Buffer,
  mimeType: string
): Promise<TabitProcessingResult> {
  const errors: string[] = [];
  const warnings: string[] = [];

  try {
    // Validate mime type
    const excelMimeTypes = [
      "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      "application/vnd.ms-excel",
      "application/octet-stream",
    ];

    if (
      !excelMimeTypes.includes(mimeType) &&
      !mimeType.includes("excel") &&
      !mimeType.includes("spreadsheet")
    ) {
      errors.push(`סוג קובץ לא נתמך: ${mimeType}. נדרש קובץ Excel.`);
      return { success: false, data: null, errors, warnings };
    }

    const workbook = XLSX.read(buffer, { type: "buffer" });

    if (!workbook.SheetNames.length) {
      errors.push("קובץ Excel ריק — אין גיליונות");
      return { success: false, data: null, errors, warnings };
    }

    // Use first sheet (typically "Export")
    const sheetName = workbook.SheetNames[0];
    const sheet = workbook.Sheets[sheetName];

    // Read as array of arrays (raw, no header mapping)
    const rows = XLSX.utils.sheet_to_json<unknown[]>(sheet, {
      header: 1,
      defval: "",
    });

    if (rows.length < 3) {
      errors.push("הקובץ חייב להכיל לפחות 3 שורות (כותרות + נתונים)");
      return { success: false, data: null, errors, warnings };
    }

    const headerRow = rows[0] as (string | number)[];

    // --- Row 1: Sub-headers → LOCATE the branch ("סניף") column ---
    // Layout A: ["שנה וחודש", "סניף", "סה"כ תקבולים", ...] → branchCol = 1
    // Layout B: ["סניף", "סה"כ תקבולים", ...]              → branchCol = 0
    const subHeaderRow = rows[1] as (string | number)[];
    let branchCol = subHeaderRow.findIndex((c) =>
      String(c ?? "").includes("סניף")
    );
    if (branchCol < 0) {
      branchCol = 1; // legacy assumption (Layout A)
      warnings.push(
        `לא נמצאה עמודת "סניף" בשורת הכותרות — מניח פריסה ישנה (עמודה B)`
      );
    }

    // Period column sits immediately LEFT of the branch column when the
    // export was grouped by period ("שנה וחודש"). Layout B has none.
    const periodColCandidate = branchCol - 1;
    const periodCol =
      periodColCandidate >= 0 &&
      (String(subHeaderRow[periodColCandidate] ?? "").includes("שנה") ||
        String(subHeaderRow[periodColCandidate] ?? "").includes("חודש"))
        ? periodColCandidate
        : null;
    if (periodCol === null) {
      warnings.push(
        'הקובץ ללא עמודת "שנה וחודש" — התקופה תילקח מבחירת המשתמש'
      );
    }

    // --- Row 0: Payment method column headers (start after branch col) ---
    const paymentMethods: string[] = [];
    const paymentMethodIndices: number[] = [];

    for (let col = branchCol + 1; col < headerRow.length; col++) {
      const header = String(headerRow[col] ?? "").trim();
      if (!header) continue;

      // Skip the "Total" column — it's the row total, not a payment method
      if (header.toLowerCase() === "total") continue;

      paymentMethods.push(header);
      paymentMethodIndices.push(col);
    }

    if (paymentMethods.length === 0) {
      errors.push("לא נמצאו אמצעי תשלום בשורת הכותרות");
      return { success: false, data: null, errors, warnings };
    }

    // --- Data rows (row 2+) ---
    let period: { month: number; year: number } | null = null;
    const branches: TabitBranchRow[] = [];

    for (let rowIdx = 2; rowIdx < rows.length; rowIdx++) {
      const row = rows[rowIdx] as (string | number)[];
      if (!row || row.length < 1) continue;

      const colA = String(row[0] ?? "").trim();
      const branchCell = String(row[branchCol] ?? "").trim();

      // Skip filter metadata rows
      if (colA.includes("מסננים שהוחלו") || colA.includes("fromDate")) {
        continue;
      }

      // Extract period BEFORE the Total-row skip: in Layout A the period
      // string sits on the brand-level Total row ("2026 מאי" | "Total" | …)
      // and only there.
      if (periodCol !== null && !period) {
        const periodCell = String(row[periodCol] ?? "").trim();
        if (periodCell) {
          period = parseHebrewPeriod(periodCell);
          if (!period) {
            warnings.push(`לא ניתן לחלץ תקופה מ: "${periodCell}"`);
          }
        }
      }

      // Skip Total/summary rows
      if (
        branchCell === "" ||
        branchCell.toLowerCase() === "total" ||
        colA.toLowerCase() === "total"
      ) {
        continue;
      }

      // Build amounts record
      const amounts: Record<string, number> = {};
      for (let i = 0; i < paymentMethods.length; i++) {
        const colIdx = paymentMethodIndices[i];
        const cellValue = row[colIdx];
        const numValue =
          typeof cellValue === "number"
            ? cellValue
            : typeof cellValue === "string" && cellValue !== ""
              ? parseFloat(cellValue.replace(/,/g, ""))
              : 0;

        if (!isNaN(numValue) && numValue !== 0) {
          amounts[paymentMethods[i]] = numValue;
        }
      }

      // Find the Total column value
      const totalColIdx = headerRow.findIndex(
        (h) => String(h).trim().toLowerCase() === "total"
      );
      let total = 0;
      if (totalColIdx >= 0) {
        const totalCell = row[totalColIdx];
        total =
          typeof totalCell === "number"
            ? totalCell
            : typeof totalCell === "string" && totalCell !== ""
              ? parseFloat(totalCell.replace(/,/g, "")) || 0
              : 0;
      }

      branches.push({
        branchName: branchCell,
        amounts,
        total,
      });
    }

    if (branches.length === 0) {
      errors.push("לא נמצאו שורות נתונים של סניפים בקובץ");
      return { success: false, data: null, errors, warnings };
    }

    return {
      success: true,
      data: {
        period,
        branches,
        paymentMethods,
      },
      errors,
      warnings,
    };
  } catch (error) {
    errors.push(
      `שגיאה בקריאת קובץ טאביט: ${error instanceof Error ? error.message : String(error)}`
    );
    return { success: false, data: null, errors, warnings };
  }
}
