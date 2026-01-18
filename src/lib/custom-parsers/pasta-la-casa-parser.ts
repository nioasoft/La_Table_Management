/**
 * Custom parser for פסטה לה קאזה (PASTA_LA_CASA) supplier files
 *
 * Problem: Each franchisee gets a separate XLS file
 * Solution: Accept either a single XLS file or a ZIP containing multiple XLS files
 *
 * File structure (per XLS):
 *   - Row 0: Headers (מספר ספק, מספר תעודה, שם ספק, מספר הזמנה, תאריך פעולה, סהכ לפני מעמ)
 *   - Rows 1-N: Transaction data
 *   - Last row: Total (סה״כ)
 *
 * Key columns:
 *   - Column C (2): שם ספק - Franchisee name
 *   - Column E (4): תאריך פעולה - Date
 *   - Column F (5): סהכ לפני מעמ - Amount before VAT (net)
 */

import * as XLSX from "xlsx";
import AdmZip from "adm-zip";
import {
  type FileProcessingResult,
  type ParsedRowData,
  roundToTwoDecimals,
} from "../file-processor";
import { createFileProcessingError } from "../file-processing-errors";
import { DEFAULT_VAT_RATE } from "@/data-access/vatRates";

// Column indices
const FRANCHISEE_NAME_COL = 2; // Column C
const DATE_COL = 4; // Column E
const AMOUNT_COL = 5; // Column F

/**
 * Parse a single XLS file from Pasta La Casa
 */
function parseSingleFile(
  buffer: Buffer,
  fileName: string
): { franchisee: string; amount: number; date: Date | null } | null {
  try {
    const workbook = XLSX.read(buffer, {
      type: "buffer",
      cellDates: true,
    });

    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return null;

    const sheet = workbook.Sheets[sheetName];
    const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: false,
      defval: "",
    });

    if (!rawData || rawData.length < 2) return null;

    // Find franchisee name from first data row
    let franchisee = "";
    let totalAmount = 0;
    let latestDate: Date | null = null;

    for (let i = 1; i < rawData.length; i++) {
      const row = rawData[i];
      if (!row) continue;

      const franchiseeCell = String(row[FRANCHISEE_NAME_COL] || "").trim();
      const amountCell = String(row[AMOUNT_COL] || "").trim();

      // Skip total row
      if (franchiseeCell === "סה״כ" || franchiseeCell === 'סה"כ') {
        continue;
      }

      // Get franchisee name
      if (!franchisee && franchiseeCell) {
        franchisee = franchiseeCell;
      }

      // Parse amount (remove currency symbol and commas)
      const cleanAmount = amountCell.replace(/[₪,\s]/g, "");
      const amount = parseFloat(cleanAmount);
      if (!isNaN(amount)) {
        totalAmount += amount;
      }

      // Parse date
      const dateCell = row[DATE_COL];
      if (dateCell) {
        const dateStr = String(dateCell).trim();
        // Parse MM/DD/YY format
        const dateParts = dateStr.match(/(\d{1,2})\/(\d{1,2})\/(\d{2})/);
        if (dateParts) {
          const month = parseInt(dateParts[1], 10) - 1;
          const day = parseInt(dateParts[2], 10);
          const year = 2000 + parseInt(dateParts[3], 10);
          const date = new Date(year, month, day);
          if (!latestDate || date > latestDate) {
            latestDate = date;
          }
        }
      }
    }

    // If no franchisee found in data, try to extract from filename
    if (!franchisee) {
      franchisee = extractFranchiseeFromFilename(fileName);
    }

    if (!franchisee || totalAmount === 0) return null;

    return {
      franchisee,
      amount: totalAmount,
      date: latestDate,
    };
  } catch {
    return null;
  }
}

/**
 * Extract franchisee name from filename
 * Patterns:
 *   - "5535 ויני כרמיאל 10-12.25.xls"
 *   - "ויני חדרה 10-12.25.xls"
 *   - "ויני יהוד 5562 10-12.25.xls"
 */
function extractFranchiseeFromFilename(filename: string): string {
  // Remove extension
  let name = filename.replace(/\.(xls|xlsx)$/i, "");

  // Remove date patterns at the end
  name = name.replace(/\s*\d{1,2}[-/]\d{1,2}[.\s]*\d{2,4}$/i, "");

  // Remove leading numbers
  name = name.replace(/^\d+\s*/, "");

  // Remove trailing numbers
  name = name.replace(/\s+\d+$/, "");

  return name.trim();
}

/**
 * Check if buffer is a ZIP file
 */
function isZipFile(buffer: Buffer): boolean {
  // ZIP files start with PK (0x50 0x4B)
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/**
 * Parse פסטה לה קאזה supplier files
 * Supports both single XLS files and ZIP archives containing multiple XLS files
 *
 * @param buffer - The file buffer
 * @param vatRate - Optional VAT rate (defaults to DEFAULT_VAT_RATE from DB config)
 */
export function parsePastaLaCasaFile(buffer: Buffer, vatRate?: number): FileProcessingResult {
  // Use provided vatRate or fall back to default
  const effectiveVatRate = vatRate ?? DEFAULT_VAT_RATE;
  const errors: import("../file-processing-errors").FileProcessingError[] = [];
  const warnings: import("../file-processing-errors").FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];

  try {
    const franchiseeAmounts: Map<string, { amount: number; date: Date | null }> = new Map();

    if (isZipFile(buffer)) {
      // Handle ZIP file with multiple XLS files
      const zip = new AdmZip(buffer);
      const zipEntries = zip.getEntries();

      let processedFiles = 0;
      for (const entry of zipEntries) {
        // Skip directories and non-XLS files
        if (entry.isDirectory) continue;
        const name = entry.name.toLowerCase();
        if (!name.endsWith(".xls") && !name.endsWith(".xlsx")) continue;

        // Skip hidden/temp files
        if (entry.entryName.includes("__MACOSX") || entry.name.startsWith(".")) {
          continue;
        }

        const fileBuffer = entry.getData();
        const result = parseSingleFile(fileBuffer, entry.name);

        if (result) {
          const existing = franchiseeAmounts.get(result.franchisee);
          if (existing) {
            franchiseeAmounts.set(result.franchisee, {
              amount: existing.amount + result.amount,
              date: result.date && (!existing.date || result.date > existing.date)
                ? result.date
                : existing.date,
            });
          } else {
            franchiseeAmounts.set(result.franchisee, {
              amount: result.amount,
              date: result.date,
            });
          }
          processedFiles++;
        } else {
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
            details: "No valid XLS files found in ZIP archive",
          })
        );
        legacyErrors.push("No valid XLS files found in ZIP archive");
        return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
      }
    } else {
      // Handle single XLS file
      const result = parseSingleFile(buffer, "uploaded.xls");
      if (result) {
        franchiseeAmounts.set(result.franchisee, {
          amount: result.amount,
          date: result.date,
        });
      } else {
        errors.push(
          createFileProcessingError("PARSE_ERROR", {
            details: "Could not parse XLS file",
          })
        );
        legacyErrors.push("Could not parse XLS file");
        return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
      }
    }

    // Convert to ParsedRowData
    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let rowNumber = 1;

    for (const [franchisee, info] of franchiseeAmounts.entries()) {
      if (info.amount === 0) continue;

      const netAmount = roundToTwoDecimals(info.amount);
      const grossAmount = roundToTwoDecimals(info.amount * (1 + effectiveVatRate));

      data.push({
        franchisee,
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
          details: "Could not extract any franchisee data from the file(s)",
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
      totalGrossAmount: roundToTwoDecimals(totalGrossAmount),
      totalNetAmount: roundToTwoDecimals(totalNetAmount),
      vatAdjusted: false,
    },
  };
}
