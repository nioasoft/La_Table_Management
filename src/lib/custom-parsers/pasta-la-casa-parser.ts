/**
 * Custom parser for פסטה לה קאזה (PASTA_LA_CASA) supplier files
 *
 * Supports three formats:
 *
 * FORMAT 1 (Old single): A single XLS exported by the supplier's POS.
 *   - One sheet (often named "ezerNN").
 *   - Header row may include OR omit "שם ספק" (franchisee name).
 *     When omitted the franchisee is derived from the filename
 *     (e.g. "5529 רגבה 1.1-31.3.26.xls" -> רגבה -> פט ויני רגבה).
 *
 * FORMAT 2 (Old bulk): ZIP containing multiple Format-1 XLS files.
 *
 * FORMAT 3 (New multi-sheet): Single XLSX with one sheet per franchisee.
 *   - Sheet name encodes the location (e.g. "כרמיאל", "ויני רגבה").
 *
 * Column resolution is header-driven (not by fixed index) because the
 * supplier ships variants with different column counts.
 *
 * Recognised headers:
 *   - שם ספק          -> franchisee name (optional)
 *   - תאריך פעולה     -> transaction date
 *   - סהכ לפני מעמ   -> net amount before VAT (required)
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

type ColumnMap = {
  franchisee: number | null;
  date: number | null;
  amount: number | null;
};

const HEADER_ALIASES: Record<keyof ColumnMap, string[]> = {
  franchisee: ["שם ספק"],
  date: ["תאריך פעולה", "תאריך"],
  amount: [
    "סהכ לפני מעמ",
    'סה"כ לפני מע"מ',
    "סה״כ לפני מע״מ",
    "סהכ לפני מע\"מ",
  ],
};

const TOTAL_ROW_MARKERS = new Set(["סהכ", 'סה"כ', "סה״כ"]);

const LOCATION_TO_FRANCHISEE: Record<string, string> = {
  "כרמיאל": "ויני כרמיאל",
  "נתניה": "פט ויני נתניה",
  "קרית אתא": "פט ויני קרית אתא",
  "חדרה": "ויני חדרה",
  "יהוד": "פט ויני יהוד",
  "עזריאלי": "פט ויני עזריאלי",
  "ויני רגבה": "פט ויני רגבה",
  "רגבה": "פט ויני רגבה",
};

function normaliseHeaderText(value: unknown): string {
  return String(value ?? "")
    .replace(/[״"׳']/g, "")
    .replace(/\s+/g, "")
    .trim();
}

function resolveColumns(headerRow: unknown[]): ColumnMap {
  const indexOfAny = (aliases: string[]): number | null => {
    const targets = aliases.map(normaliseHeaderText);
    for (let i = 0; i < headerRow.length; i++) {
      if (targets.includes(normaliseHeaderText(headerRow[i]))) return i;
    }
    return null;
  };

  return {
    franchisee: indexOfAny(HEADER_ALIASES.franchisee),
    date: indexOfAny(HEADER_ALIASES.date),
    amount: indexOfAny(HEADER_ALIASES.amount),
  };
}

function isTotalRow(row: unknown[]): boolean {
  for (let i = 0; i < Math.min(row.length, 4); i++) {
    if (TOTAL_ROW_MARKERS.has(normaliseHeaderText(row[i]))) return true;
  }
  return false;
}

function parseDateCell(cell: unknown): Date | null {
  if (cell instanceof Date && !isNaN(cell.getTime())) return cell;
  const s = String(cell ?? "").trim();
  if (!s) return null;
  const m = s.match(/(\d{1,2})\/(\d{1,2})\/(\d{2,4})/);
  if (!m) return null;
  const month = parseInt(m[1], 10) - 1;
  const day = parseInt(m[2], 10);
  const yearRaw = parseInt(m[3], 10);
  const year = yearRaw < 100 ? 2000 + yearRaw : yearRaw;
  return new Date(year, month, day);
}

function parseAmountCell(cell: unknown): number {
  const cleaned = String(cell ?? "").replace(/[₪,\s]/g, "");
  const n = parseFloat(cleaned);
  return isNaN(n) ? 0 : n;
}

type AggregatedRow = {
  franchisee: string;
  amount: number;
  date: Date | null;
};

function aggregateRows(
  rawData: unknown[][],
  cols: ColumnMap
): { amount: number; date: Date | null; franchisee: string } | null {
  if (cols.amount === null) return null;

  let franchisee = "";
  let totalAmount = 0;
  let latestDate: Date | null = null;

  for (let i = 1; i < rawData.length; i++) {
    const row = rawData[i];
    if (!row) continue;
    if (isTotalRow(row)) continue;

    if (cols.franchisee !== null && !franchisee) {
      const cell = String(row[cols.franchisee] ?? "").trim();
      if (cell) franchisee = cell;
    }

    totalAmount += parseAmountCell(row[cols.amount]);

    if (cols.date !== null) {
      const d = parseDateCell(row[cols.date]);
      if (d && (!latestDate || d > latestDate)) latestDate = d;
    }
  }

  return { amount: totalAmount, date: latestDate, franchisee };
}

/**
 * Parse a single XLS file from Pasta La Casa.
 */
function parseSingleFile(
  buffer: Buffer,
  fileName: string
): AggregatedRow | null {
  try {
    const workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
    const sheetName = workbook.SheetNames[0];
    if (!sheetName) return null;

    const sheet = workbook.Sheets[sheetName];
    const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: "",
    });

    if (!rawData || rawData.length < 2) return null;

    const cols = resolveColumns(rawData[0]);
    const aggregate = aggregateRows(rawData, cols);
    if (!aggregate) return null;

    let { franchisee } = aggregate;
    if (!franchisee) franchisee = extractFranchiseeFromFilename(fileName);
    if (!franchisee || aggregate.amount === 0) return null;

    return { franchisee, amount: aggregate.amount, date: aggregate.date };
  } catch {
    return null;
  }
}

/**
 * Parse a single sheet from a multi-sheet XLSX (new format).
 * Sheet name encodes the franchisee location.
 */
function parseSheetData(
  sheet: XLSX.WorkSheet,
  sheetName: string
): AggregatedRow | null {
  try {
    const rawData: unknown[][] = XLSX.utils.sheet_to_json(sheet, {
      header: 1,
      raw: true,
      defval: "",
    });

    if (!rawData || rawData.length < 2) return null;

    const cols = resolveColumns(rawData[0]);
    const aggregate = aggregateRows(rawData, cols);
    if (!aggregate) return null;

    let { franchisee } = aggregate;
    if (!franchisee) franchisee = mapSheetNameToFranchisee(sheetName);
    if (!franchisee || aggregate.amount === 0) return null;

    return { franchisee, amount: aggregate.amount, date: aggregate.date };
  } catch {
    return null;
  }
}

function mapSheetNameToFranchisee(sheetName: string): string {
  return LOCATION_TO_FRANCHISEE[sheetName] || sheetName;
}

/**
 * Extract franchisee name from filename.
 * Patterns:
 *   - "5535 ויני כרמיאל 10-12.25.xls"
 *   - "ויני חדרה 10-12.25.xls"
 *   - "ויני יהוד 5562 10-12.25.xls"
 *   - "5529 רגבה 1.1-31.3.26.xls"  (quarterly DD.MM-DD.MM.YY)
 */
function extractFranchiseeFromFilename(filename: string): string {
  let name = filename.replace(/\.(xls|xlsx)$/i, "");

  // Strip quarterly form "1.1-31.3.26" / "1.1-31.3.2026"
  name = name.replace(
    /\s*\d{1,2}\.\d{1,2}\s*[-/]\s*\d{1,2}\.\d{1,2}[.\s]*\d{2,4}$/,
    ""
  );

  // Strip "10-12.25" / "10-12/25" trailing form
  name = name.replace(/\s*\d{1,2}[-/]\d{1,2}[.\s]*\d{2,4}$/i, "");

  // Strip leading and trailing standalone numbers (supplier codes)
  name = name.replace(/^\d+\s*/, "");
  name = name.replace(/\s+\d+$/, "");
  name = name.trim();

  for (const [keyword, franchisee] of Object.entries(LOCATION_TO_FRANCHISEE)) {
    if (name.includes(keyword)) return franchisee;
  }

  return name;
}

function isZipFile(buffer: Buffer): boolean {
  // ZIP files start with PK (0x50 0x4B)
  return buffer.length > 4 && buffer[0] === 0x50 && buffer[1] === 0x4b;
}

/**
 * Parse פסטה לה קאזה supplier files.
 * Supports single XLS, ZIP of XLS, and multi-sheet XLSX.
 *
 * @param buffer - The file buffer
 * @param vatRate - Optional VAT rate (defaults to DEFAULT_VAT_RATE from DB config)
 * @param fileName - Original uploaded filename (used as fallback when the
 *                   single-sheet variant omits the שם ספק column)
 */
export function parsePastaLaCasaFile(
  buffer: Buffer,
  vatRate?: number,
  fileName?: string
): FileProcessingResult {
  const effectiveVatRate = vatRate ?? DEFAULT_VAT_RATE;
  const errors: import("../file-processing-errors").FileProcessingError[] = [];
  const warnings: import("../file-processing-errors").FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];

  try {
    const franchiseeAmounts: Map<string, { amount: number; date: Date | null }> =
      new Map();

    // Try Excel first (XLSX is also a ZIP, so check Excel before ZIP).
    let isExcelFile = false;
    let workbook: XLSX.WorkBook | null = null;

    try {
      workbook = XLSX.read(buffer, { type: "buffer", cellDates: true });
      isExcelFile =
        workbook.SheetNames.length > 0 &&
        workbook.Sheets[workbook.SheetNames[0]] !== undefined;
    } catch {
      isExcelFile = false;
    }

    const upsertFranchisee = (row: AggregatedRow) => {
      const existing = franchiseeAmounts.get(row.franchisee);
      if (existing) {
        franchiseeAmounts.set(row.franchisee, {
          amount: existing.amount + row.amount,
          date:
            row.date && (!existing.date || row.date > existing.date)
              ? row.date
              : existing.date,
        });
      } else {
        franchiseeAmounts.set(row.franchisee, {
          amount: row.amount,
          date: row.date,
        });
      }
    };

    if (isExcelFile && workbook) {
      if (workbook.SheetNames.length > 1) {
        // New format: XLSX with multiple sheets (each sheet = franchisee)
        let processedSheets = 0;

        for (const sheetName of workbook.SheetNames) {
          const result = parseSheetData(workbook.Sheets[sheetName], sheetName);

          if (result) {
            upsertFranchisee(result);
            processedSheets++;
          } else {
            warnings.push(
              createFileProcessingError("PARSE_ERROR", {
                details: `Could not parse sheet: ${sheetName}`,
              })
            );
            legacyWarnings.push(`Could not parse sheet: ${sheetName}`);
          }
        }

        if (processedSheets === 0) {
          errors.push(
            createFileProcessingError("PARSE_ERROR", {
              details: "Could not parse any sheets in the XLSX file",
            })
          );
          legacyErrors.push("Could not parse any sheets in the XLSX file");
          return createResult(false, data, errors, warnings, legacyErrors, legacyWarnings, 0);
        }
      } else {
        // Old format: single-sheet XLS / XLSX file
        const result = parseSingleFile(buffer, fileName ?? "uploaded.xls");
        if (result) {
          upsertFranchisee(result);
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
    } else if (isZipFile(buffer)) {
      // Old bulk format: ZIP of per-franchisee XLS files
      const zip = new AdmZip(buffer);
      const zipEntries = zip.getEntries();

      let processedFiles = 0;
      for (const entry of zipEntries) {
        if (entry.isDirectory) continue;
        const name = entry.name.toLowerCase();
        if (!name.endsWith(".xls") && !name.endsWith(".xlsx")) continue;
        if (entry.entryName.includes("__MACOSX") || entry.name.startsWith(".")) {
          continue;
        }

        const fileBuffer = entry.getData();
        const result = parseSingleFile(fileBuffer, entry.name);

        if (result) {
          upsertFranchisee(result);
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
      errors.push(
        createFileProcessingError("PARSE_ERROR", {
          details: "Unsupported file format. Expected XLS, XLSX, or ZIP file.",
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

    for (const [franchisee, info] of franchiseeAmounts.entries()) {
      if (info.amount === 0) continue;

      const netAmount = roundAmount(info.amount);
      const grossAmount = roundAmount(info.amount * (1 + effectiveVatRate));

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
      totalGrossAmount: roundAmount(totalGrossAmount),
      totalNetAmount: roundAmount(totalNetAmount),
      vatAdjusted: false,
    },
  };
}
