/**
 * Custom parser for דגי הקיבוצים (DAGEI_HAKIBBUTZIM) supplier files
 *
 * Supports two formats:
 *
 * FORMAT 1: Single XLSX file
 *   - One franchisee per file
 *   - Sheet named "Report" (or first sheet)
 *   - Row 0: Headers — every column is located BY HEADER, never by position.
 *     The export gained a "מפתח לקוח" column in Q2-2026 which shifted
 *     everything right by one (the parser then read מע"מ as the amount).
 *   - Status column has a blank header; it is always the first column.
 *   - Filters: status "מסמך פתוח", doc type "חשבונית מס" / "חשבונית זיכוי"
 *   - Amount comes from "סכום לפני מע"מ" (credit notes already negative)
 *
 * FORMAT 2: ZIP archive containing multiple XLSX files
 *   - Each file is for a different franchisee
 *   - Same structure as Format 1 per file
 *
 * Amounts are already before VAT, so the supplier should have vatIncluded =
 * false. The parser returns that column as netAmount and calculates
 * grossAmount = netAmount * (1 + vatRate).
 */

import * as XLSX from "xlsx";
import AdmZip from "adm-zip";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundAmount,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";
import { DEFAULT_VAT_RATE } from "@/data-access/vatRates";
import { normalizeBusinessId } from "@/lib/business-id-utils";
import type { Anomaly } from "@/types/file-anomalies";

/**
 * One row that failed the Dagei status / doc-type filter. Aggregated into a
 * single FILTERED_ROWS_BY_DOCTYPE anomaly at the end of parsing.
 */
interface FilteredRow {
  rowNumber: number;
  status: string;
  docType: string;
  amount: number;
}

// The status column ships with a blank header — it is always the first one.
const STATUS_COL = 0;

// Filter values
const VALID_STATUS = "מסמך פתוח";
const VALID_DOC_TYPES = new Set(["חשבונית מס", "חשבונית זיכוי"]);

interface DageiColumns {
  docType: number;
  date: number;
  businessId: number;
  address: number;
  amountBeforeVat: number;
}

/** Quote-insensitive header key: `סכום לפני מע"מ` → `סכום לפני מעמ`. */
function normalizeHeader(value: unknown): string {
  return String(value ?? "")
    .replace(/["'`׳״]/g, "")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Locate the columns we need by header text. Throws (rather than guessing an
 * index) so a future reshuffle surfaces as a parse error instead of silently
 * summing the wrong column.
 */
function resolveColumns(headerRow: unknown[]): DageiColumns {
  const headers = headerRow.map(normalizeHeader);
  const find = (predicate: (h: string) => boolean, label: string): number => {
    const index = headers.findIndex(predicate);
    if (index === -1) {
      throw new Error(
        `לא נמצאה עמודת "${label}" בקובץ דגי הקיבוצים — ייתכן שהפורמט של הייצוא השתנה`
      );
    }
    return index;
  };

  return {
    docType: find((h) => h === "סוג מסמך", 'סוג מסמך'),
    date: find((h) => h === "תאריך מסמך", "תאריך מסמך"),
    businessId: find((h) => h.startsWith("מספר עוסק"), "מספר עוסק / ח.פ"),
    address: find((h) => h === "כתובת", "כתובת"),
    // Must not match "מעמ" (the VAT column) or "ללא מעמ".
    amountBeforeVat: find((h) => h === "סכום לפני מעמ", 'סכום לפני מע"מ'),
  };
}

/**
 * Parse Excel serial date number to Date object
 */
function parseExcelDate(serial: number): Date | null {
  if (!serial || serial < 1) return null;
  // Excel dates are days since 1899-12-30
  const excelEpoch = new Date(1899, 11, 30);
  const date = new Date(excelEpoch.getTime() + serial * 86400000);
  return isNaN(date.getTime()) ? null : date;
}

interface FranchiseeData {
  amount: number;
  date: Date | null;
  name: string;
}

/**
 * Parse a single XLSX file from דגי הקיבוצים
 * Groups transactions by business ID, sums amounts, and tracks latest date
 */
function parseSingleXlsx(
  buffer: Buffer,
  _fileName: string,
  filteredRowsOut?: FilteredRow[]
): Map<string, FranchiseeData> {
  const franchiseeAmounts = new Map<string, FranchiseeData>();

  const workbook = XLSX.read(buffer, { type: "buffer", raw: true });

  // Try "Report" sheet first, then fall back to first sheet
  const reportSheet = workbook.SheetNames.find((name) => name === "Report");
  const sheetName: string | undefined = reportSheet ?? workbook.SheetNames[0];
  if (!sheetName) return franchiseeAmounts;

  const sheet = workbook.Sheets[sheetName];
  const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
    header: 1,
    raw: true,
    defval: "",
  });

  if (!rawData || rawData.length < 2) return franchiseeAmounts;

  const cols = resolveColumns(rawData[0]);

  // Skip header row (row 0), process data rows
  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row) continue;

    const status = String(row[STATUS_COL] || "").trim();
    const docType = String(row[cols.docType] || "").trim();

    // Filter: only open documents that are invoices or credit notes.
    // Track everything that gets dropped here so we can surface it in the
    // pre-save review modal — see FILTERED_ROWS_BY_DOCTYPE anomaly below.
    if (status !== VALID_STATUS || !VALID_DOC_TYPES.has(docType)) {
      if (filteredRowsOut) {
        const amountRaw = row[cols.amountBeforeVat];
        const amount =
          typeof amountRaw === "number"
            ? amountRaw
            : parseFloat(String(amountRaw ?? "").replace(/[₪,\s]/g, ""));
        // i+1 because the source spreadsheet is 1-indexed, with row 1 being
        // the header row; data rows therefore start at 2.
        filteredRowsOut.push({
          rowNumber: i + 1,
          status: status || "(ריק)",
          docType: docType || "(ריק)",
          amount: Number.isNaN(amount) ? 0 : amount,
        });
      }
      continue;
    }

    // Get business ID as franchisee identifier
    // Normalize to handle format variations (e.g., "123456789-0" -> "123456789")
    const rawBusinessId = String(row[cols.businessId] || "").trim();
    const businessId = normalizeBusinessId(rawBusinessId);
    if (!businessId) continue;

    // Parse amount before VAT
    const amountRaw = row[cols.amountBeforeVat];
    const amount =
      typeof amountRaw === "number"
        ? amountRaw
        : parseFloat(String(amountRaw).replace(/[₪,\s]/g, ""));
    if (isNaN(amount)) continue;

    // Parse date (Excel serial number)
    const dateRaw = row[cols.date];
    let date: Date | null = null;
    if (typeof dateRaw === "number") {
      date = parseExcelDate(dateRaw);
    }

    // Get address as franchisee display name
    const address = String(row[cols.address] || "").trim();

    const existing = franchiseeAmounts.get(businessId);
    if (existing) {
      existing.amount += amount;
      if (date && (!existing.date || date > existing.date)) {
        existing.date = date;
      }
    } else {
      franchiseeAmounts.set(businessId, {
        amount,
        date,
        name: address || businessId,
      });
    }
  }

  return franchiseeAmounts;
}

/**
 * Check if buffer is a ZIP file
 */
function isZipFile(buffer: Buffer): boolean {
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/**
 * Parse דגי הקיבוצים supplier files
 * Supports:
 * - Single XLSX files
 * - ZIP archives containing multiple XLSX files
 *
 * @param buffer - The file buffer
 * @param vatRate - Optional VAT rate (defaults to DEFAULT_VAT_RATE)
 */
export function parseDageiHakibbutzimFile(
  buffer: Buffer,
  vatRate?: number
): FileProcessingResult {
  const effectiveVatRate = vatRate ?? DEFAULT_VAT_RATE;
  const errors: import("../file-processing-errors").FileProcessingError[] = [];
  const warnings: import("../file-processing-errors").FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];
  const filteredRows: FilteredRow[] = [];

  try {
    const allFranchisees = new Map<string, FranchiseeData>();

    // Try to parse as Excel file first (XLSX files are also ZIP archives)
    let isExcelFile = false;
    try {
      const workbook = XLSX.read(buffer, { type: "buffer" });
      isExcelFile =
        workbook.SheetNames.length > 0 &&
        workbook.Sheets[workbook.SheetNames[0]] !== undefined;
    } catch {
      isExcelFile = false;
    }

    if (isExcelFile) {
      // Single XLSX file
      const result = parseSingleXlsx(buffer, "uploaded.xlsx", filteredRows);
      for (const [key, value] of result) {
        allFranchisees.set(key, value);
      }
    } else if (isZipFile(buffer)) {
      // ZIP archive with multiple XLSX files
      const zip = new AdmZip(buffer);
      const zipEntries = zip.getEntries();
      let processedFiles = 0;

      for (const entry of zipEntries) {
        if (entry.isDirectory) continue;
        const name = entry.name.toLowerCase();
        if (!name.endsWith(".xls") && !name.endsWith(".xlsx")) continue;
        if (entry.entryName.includes("__MACOSX") || entry.name.startsWith("."))
          continue;

        const fileBuffer = entry.getData();
        try {
          const result = parseSingleXlsx(fileBuffer, entry.name, filteredRows);
          for (const [key, value] of result) {
            const existing = allFranchisees.get(key);
            if (existing) {
              existing.amount += value.amount;
              if (value.date && (!existing.date || value.date > existing.date)) {
                existing.date = value.date;
              }
            } else {
              allFranchisees.set(key, { ...value });
            }
          }
          processedFiles++;
        } catch (err) {
          // Includes the "column not found" message — a layout change must be
          // readable, not hidden behind a generic parse failure.
          const reason = err instanceof Error ? err.message : "שגיאה לא ידועה";
          warnings.push(
            createFileProcessingError("PARSE_ERROR", {
              details: `${entry.name}: ${reason}`,
            })
          );
          legacyWarnings.push(`${entry.name}: ${reason}`);
        }
      }

      if (processedFiles === 0) {
        errors.push(
          createFileProcessingError("PARSE_ERROR", {
            details: "No valid XLSX files found in ZIP archive",
          })
        );
        legacyErrors.push("No valid XLSX files found in ZIP archive");
        return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
      }
    } else {
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Unsupported file format. Expected XLSX or ZIP file.",
        })
      );
      legacyErrors.push("Unsupported file format");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    // Convert to ParsedRowData
    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let rowNumber = 1;

    for (const [businessId, info] of allFranchisees.entries()) {
      if (info.amount === 0) continue;

      const netAmount = roundAmount(info.amount);
      const grossAmount = roundAmount(
        info.amount * (1 + effectiveVatRate)
      );

      // Use the address as the franchisee name for matching
      // Include business ID (מספר עוסק) for file naming and duplicate detection
      data.push({
        franchisee: info.name,
        franchiseeId: businessId,
        date: info.date,
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
          details:
            "Could not extract any franchisee data from the file(s). Check that there are rows with status 'מסמך פתוח' and type 'חשבונית מס' or 'חשבונית זיכוי'.",
        })
      );
      legacyErrors.push("Could not extract any franchisee data from the file(s)");
      return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
    }

    const anomalies = buildAnomalies(filteredRows);

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
      anomalies
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

/**
 * Group filtered rows by document type and emit a FILTERED_ROWS_BY_DOCTYPE
 * anomaly summarising the breakdown plus the total ₪ excluded. Returns an
 * empty array when no rows were filtered (so the caller can spread freely).
 */
function buildAnomalies(filteredRows: FilteredRow[]): Anomaly[] {
  if (filteredRows.length === 0) return [];

  // Group by "<doc-type> · <status>" for a clean Hebrew breakdown line.
  const groups = new Map<string, { count: number; amount: number }>();
  for (const fr of filteredRows) {
    const key = `${fr.docType} · ${fr.status}`;
    const existing = groups.get(key) ?? { count: 0, amount: 0 };
    existing.count += 1;
    existing.amount += fr.amount;
    groups.set(key, existing);
  }

  const breakdown = Array.from(groups.entries()).map(([label, agg]) => ({
    label,
    count: agg.count,
    amount: roundAmount(agg.amount),
  }));

  const totalAmount = roundAmount(
    filteredRows.reduce((sum, fr) => sum + fr.amount, 0)
  );

  const summaryLine = breakdown
    .map((g) => `${g.label}: ${g.count} שורות (${formatIls(g.amount)})`)
    .join("; ");

  return [
    {
      code: "FILTERED_ROWS_BY_DOCTYPE",
      severity: "warning",
      messageHe: `${filteredRows.length} שורות נופלות מפילטר ה-parser — סה"כ ${formatIls(totalAmount)} לא נכללו`,
      details: {
        explanationHe:
          "ה-parser של דגי הקיבוצים כולל רק 'מסמך פתוח' מסוג 'חשבונית מס' או 'חשבונית זיכוי'. תעודות משלוח, קבלות ומסמכים סגורים מוחרגים בכוונה כדי למנוע ספירה כפולה כשתעודת משלוח הופכת לחשבונית מס.",
        breakdown,
        rows: filteredRows,
        summaryLine,
      },
      suggestedActions: [
        {
          type: "acknowledge_only",
          labelHe: "הבנתי, להמשיך",
        },
      ],
      affectedRowNumbers: filteredRows.map((r) => r.rowNumber),
      affectedAmount: totalAmount,
    },
  ];
}

function formatIls(n: number): string {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(n);
}
