/**
 * Custom parser for דגי הקיבוצים (DAGEI_HAKIBBUTZIM) supplier files
 *
 * Supports two formats:
 *
 * FORMAT 1: Single XLSX file
 *   - One franchisee per file
 *   - Sheet named "Report" (or first sheet)
 *   - Row 0: Headers
 *   - Column A (0): Status - filter for "מסמך פתוח" only
 *   - Column B (1): Document type - include "חשבונית מס" and "חשבונית זיכוי" only
 *   - Column D (3): Date (Excel serial number)
 *   - Column E (4): Business ID (מספר עוסק)
 *   - Column F (5): Address (used as fallback franchisee name)
 *   - Column O (14): Amount before VAT (credit notes already negative)
 *
 * FORMAT 2: ZIP archive containing multiple XLSX files
 *   - Each file is for a different franchisee
 *   - Same structure as Format 1 per file
 *
 * Amounts in column O are already before VAT, so the supplier should have
 * vatIncluded = false. The parser returns col O as netAmount and calculates
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

// Column indices
const STATUS_COL = 0; // Column A
const DOC_TYPE_COL = 1; // Column B
const DATE_COL = 3; // Column D
const BUSINESS_ID_COL = 4; // Column E
const ADDRESS_COL = 5; // Column F
const AMOUNT_BEFORE_VAT_COL = 14; // Column O

// Filter values
const VALID_STATUS = "מסמך פתוח";
const VALID_DOC_TYPES = new Set(["חשבונית מס", "חשבונית זיכוי"]);

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
  _fileName: string
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

  // Skip header row (row 0), process data rows
  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row) continue;

    const status = String(row[STATUS_COL] || "").trim();
    const docType = String(row[DOC_TYPE_COL] || "").trim();

    // Filter: only open documents that are invoices or credit notes
    if (status !== VALID_STATUS || !VALID_DOC_TYPES.has(docType)) {
      continue;
    }

    // Get business ID as franchisee identifier
    // Normalize to handle format variations (e.g., "123456789-0" -> "123456789")
    const rawBusinessId = String(row[BUSINESS_ID_COL] || "").trim();
    const businessId = normalizeBusinessId(rawBusinessId);
    if (!businessId) continue;

    // Parse amount before VAT (column O)
    const amountRaw = row[AMOUNT_BEFORE_VAT_COL];
    const amount =
      typeof amountRaw === "number"
        ? amountRaw
        : parseFloat(String(amountRaw).replace(/[₪,\s]/g, ""));
    if (isNaN(amount)) continue;

    // Parse date (Excel serial number)
    const dateRaw = row[DATE_COL];
    let date: Date | null = null;
    if (typeof dateRaw === "number") {
      date = parseExcelDate(dateRaw);
    }

    // Get address as franchisee display name
    const address = String(row[ADDRESS_COL] || "").trim();

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
      const result = parseSingleXlsx(buffer, "uploaded.xlsx");
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
          const result = parseSingleXlsx(fileBuffer, entry.name);
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
        } catch {
          warnings.push(
            createFileProcessingError("PARSE_ERROR", {
              details: `Could not parse file: ${entry.name}`,
            })
          );
          legacyWarnings.push(`Could not parse file: ${entry.name}`);
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
