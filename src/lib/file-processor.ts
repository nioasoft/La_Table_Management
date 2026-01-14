import * as XLSX from "xlsx";
import type { SupplierFileMapping } from "@/db/schema";
import {
  type FileProcessingError,
  type FileProcessingErrorCategory,
  type FileProcessingErrorSeverity,
  createFileProcessingError,
  createCustomError,
  FILE_PROCESSING_ERROR_CODES,
} from "./file-processing-errors";

// Israel's standard VAT rate (18%)
export const ISRAEL_VAT_RATE = 0.18;

// Parsed row data from supplier files
export interface ParsedRowData {
  franchisee: string;
  date: Date | null;
  grossAmount: number;
  netAmount: number; // Amount before VAT (for commission calculation)
  originalAmount: number; // Original amount from file (for reference)
  rowNumber: number;
}

// Result of file processing with enhanced error handling
export interface FileProcessingResult {
  success: boolean;
  data: ParsedRowData[];
  errors: FileProcessingError[];
  warnings: FileProcessingError[];
  /** @deprecated Use errors array instead. Kept for backwards compatibility. */
  legacyErrors: string[];
  /** @deprecated Use warnings array instead. Kept for backwards compatibility. */
  legacyWarnings: string[];
  summary: {
    totalRows: number;
    processedRows: number;
    skippedRows: number;
    totalGrossAmount: number;
    totalNetAmount: number;
    vatAdjusted: boolean;
  };
}

// Configuration for VAT adjustment
export interface VatConfig {
  vatIncluded: boolean;
  vatRate?: number; // Default: ISRAEL_VAT_RATE
}

/**
 * Calculate net amount from gross amount (remove VAT)
 * Formula: Net = Gross / (1 + VAT Rate)
 */
export function calculateNetFromGross(grossAmount: number, vatRate: number = ISRAEL_VAT_RATE): number {
  return grossAmount / (1 + vatRate);
}

/**
 * Calculate gross amount from net amount (add VAT)
 * Formula: Gross = Net * (1 + VAT Rate)
 */
export function calculateGrossFromNet(netAmount: number, vatRate: number = ISRAEL_VAT_RATE): number {
  return netAmount * (1 + vatRate);
}

/**
 * Round to 2 decimal places for financial calculations
 */
export function roundToTwoDecimals(value: number): number {
  return Math.round(value * 100) / 100;
}

/**
 * Convert column letter (A, B, C, etc.) to zero-based index
 */
function columnLetterToIndex(column: string): number {
  const upper = column.toUpperCase();
  let index = 0;
  for (let i = 0; i < upper.length; i++) {
    index = index * 26 + (upper.charCodeAt(i) - 64);
  }
  return index - 1; // Convert to zero-based
}

/**
 * Get cell value from row data using column identifier
 * Supports both column letters (A, B, C) and column names
 */
function getCellValue(row: unknown[], columnId: string, headers: string[]): unknown {
  // Check if it's a column letter (A-Z or AA-ZZ pattern)
  if (/^[A-Z]+$/i.test(columnId)) {
    const index = columnLetterToIndex(columnId);
    return row[index];
  }

  // Otherwise treat it as a column header name
  const headerIndex = headers.findIndex(h =>
    h?.toString().toLowerCase().trim() === columnId.toLowerCase().trim()
  );

  if (headerIndex >= 0) {
    return row[headerIndex];
  }

  return undefined;
}

/**
 * Parse a numeric value from cell content
 */
function parseNumericValue(value: unknown): number {
  if (value === null || value === undefined) return 0;

  // If already a number, return it
  if (typeof value === "number") {
    return isNaN(value) ? 0 : value;
  }

  // Convert to string and clean up
  let strValue = String(value).trim();

  // Remove currency symbols and thousands separators
  strValue = strValue
    .replace(/[₪$€£¥]/g, "") // Remove currency symbols
    .replace(/,/g, "")        // Remove thousands separators
    .replace(/\s/g, "")       // Remove whitespace
    .trim();

  // Handle negative numbers in parentheses: (100) -> -100
  if (strValue.startsWith("(") && strValue.endsWith(")")) {
    strValue = "-" + strValue.slice(1, -1);
  }

  const parsed = parseFloat(strValue);
  return isNaN(parsed) ? 0 : parsed;
}

/**
 * Parse a date value from cell content
 */
function parseDateValue(value: unknown): Date | null {
  if (value === null || value === undefined) return null;

  // If already a Date, return it
  if (value instanceof Date) {
    return isNaN(value.getTime()) ? null : value;
  }

  // Handle Excel serial date numbers
  if (typeof value === "number") {
    // Excel dates are days since 1899-12-30
    const excelEpoch = new Date(1899, 11, 30);
    const date = new Date(excelEpoch.getTime() + value * 86400000);
    return isNaN(date.getTime()) ? null : date;
  }

  // Try parsing string date
  const strValue = String(value).trim();
  if (!strValue) return null;

  // Try various date formats
  const dateFormats = [
    // ISO format
    /^(\d{4})-(\d{2})-(\d{2})$/,
    // US format: MM/DD/YYYY
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
    // European format: DD/MM/YYYY
    /^(\d{1,2})\.(\d{1,2})\.(\d{4})$/,
    // Hebrew format: DD/MM/YYYY
    /^(\d{1,2})\/(\d{1,2})\/(\d{4})$/,
  ];

  for (const format of dateFormats) {
    const match = strValue.match(format);
    if (match) {
      let year: number, month: number, day: number;

      if (format.source.startsWith("^(\\d{4})")) {
        // ISO format: YYYY-MM-DD
        [, year, month, day] = match.map(Number);
      } else {
        // DD/MM/YYYY or similar
        [, day, month, year] = match.map(Number);
      }

      const date = new Date(year, month - 1, day);
      if (!isNaN(date.getTime())) return date;
    }
  }

  // Try native Date parsing as fallback
  const date = new Date(strValue);
  return isNaN(date.getTime()) ? null : date;
}

/**
 * Check if a row should be skipped based on skip keywords
 */
function shouldSkipRow(row: unknown[], skipKeywords: string[]): boolean {
  if (!skipKeywords || skipKeywords.length === 0) return false;

  const rowText = row.map(cell => String(cell || "").toLowerCase()).join(" ");

  return skipKeywords.some(keyword =>
    rowText.includes(keyword.toLowerCase().trim())
  );
}

/**
 * Parse an Excel/CSV file buffer using the supplier's file mapping configuration
 */
export function parseSupplierFile(
  buffer: Buffer,
  fileMapping: SupplierFileMapping,
  vatConfig: VatConfig
): FileProcessingResult {
  const errors: FileProcessingError[] = [];
  const warnings: FileProcessingError[] = [];
  const legacyErrors: string[] = [];
  const legacyWarnings: string[] = [];
  const data: ParsedRowData[] = [];

  /**
   * Helper to add an error with both new and legacy format
   */
  const addError = (error: FileProcessingError) => {
    errors.push(error);
    legacyErrors.push(error.message + (error.details ? `: ${error.details}` : ''));
  };

  /**
   * Helper to add a warning with both new and legacy format
   */
  const addWarning = (warning: FileProcessingError) => {
    warnings.push(warning);
    legacyWarnings.push(warning.message + (warning.details ? `: ${warning.details}` : ''));
  };

  /**
   * Helper to create a failed result
   */
  const createFailedResult = (totalRows: number = 0): FileProcessingResult => ({
    success: false,
    data: [],
    errors,
    warnings,
    legacyErrors,
    legacyWarnings,
    summary: {
      totalRows,
      processedRows: 0,
      skippedRows: 0,
      totalGrossAmount: 0,
      totalNetAmount: 0,
      vatAdjusted: false,
    },
  });

  try {
    // Read the workbook
    let workbook: XLSX.WorkBook;
    try {
      workbook = XLSX.read(buffer, {
        type: "buffer",
        cellDates: true, // Parse dates automatically
        cellNF: true,    // Keep number formats
      });
    } catch (parseError) {
      addError(createFileProcessingError('FILE_CORRUPTED', {
        details: parseError instanceof Error ? parseError.message : 'Unknown parsing error',
      }));
      return createFailedResult();
    }

    // Get the sheet (use configured sheetName or first sheet)
    let sheetName = workbook.SheetNames[0];
    if (fileMapping.sheetName) {
      if (workbook.SheetNames.includes(fileMapping.sheetName)) {
        sheetName = fileMapping.sheetName;
      } else {
        addWarning(createFileProcessingError('PARSE_ERROR', {
          details: `Configured sheet "${fileMapping.sheetName}" not found, using "${sheetName}"`,
        }));
      }
    }
    if (!sheetName) {
      addError(createFileProcessingError('NO_WORKSHEETS'));
      return createFailedResult();
    }

    const sheet = workbook.Sheets[sheetName];

    // Convert sheet to array of arrays
    let rawData: unknown[][];
    try {
      rawData = XLSX.utils.sheet_to_json(sheet, {
        header: 1, // Return array of arrays
        raw: false, // Format numbers/dates
        defval: "", // Default empty cells to empty string
      });
    } catch (conversionError) {
      addError(createFileProcessingError('PARSE_ERROR', {
        details: conversionError instanceof Error ? conversionError.message : 'Failed to convert sheet to data',
      }));
      return createFailedResult();
    }

    if (!rawData || rawData.length === 0) {
      addError(createFileProcessingError('FILE_EMPTY'));
      return createFailedResult();
    }

    // Get configuration values (convert to 0-indexed)
    const headerRowIndex = (fileMapping.headerRow || 1) - 1;
    const dataStartRowIndex = (fileMapping.dataStartRow || 2) - 1;
    const rowsToSkip = fileMapping.rowsToSkip || 0;
    const skipKeywords = fileMapping.skipKeywords || [];

    // Validate row indices
    if (headerRowIndex >= rawData.length) {
      addError(createFileProcessingError('HEADER_ROW_NOT_FOUND', {
        details: `Header row ${fileMapping.headerRow} does not exist (file has ${rawData.length} rows)`,
        rowNumber: fileMapping.headerRow,
        suggestion: `The file only has ${rawData.length} rows. Update the header row configuration to a valid row number.`,
      }));
      return createFailedResult(rawData.length);
    }

    // Get headers
    const headers = (rawData[headerRowIndex] || []).map(h => String(h || ""));

    // Calculate data end row (accounting for rows to skip at the end)
    const dataEndRowIndex = rawData.length - rowsToSkip;

    // Get column mappings
    const { franchiseeColumn, amountColumn, dateColumn } = fileMapping.columnMappings;

    // Validate column mappings exist
    if (!franchiseeColumn) {
      addError(createFileProcessingError('MISSING_FRANCHISEE_COLUMN', {
        suggestion: 'Configure the franchisee column in the supplier file mapping settings',
      }));
    }
    if (!amountColumn) {
      addError(createFileProcessingError('MISSING_AMOUNT_COLUMN', {
        suggestion: 'Configure the amount column in the supplier file mapping settings',
      }));
    }
    if (!franchiseeColumn || !amountColumn) {
      return createFailedResult(rawData.length);
    }

    // Check if date column is configured
    if (!dateColumn) {
      addWarning(createFileProcessingError('MISSING_DATE_COLUMN'));
    }

    // Validate column references exist in header (for named columns)
    if (!/^[A-Z]+$/i.test(franchiseeColumn)) {
      const franchiseeColIndex = headers.findIndex(
        h => h?.toString().toLowerCase().trim() === franchiseeColumn.toLowerCase().trim()
      );
      if (franchiseeColIndex < 0) {
        addError(createFileProcessingError('INVALID_COLUMN_REFERENCE', {
          columnName: franchiseeColumn,
          details: `Column "${franchiseeColumn}" not found in headers`,
          suggestion: `Available columns: ${headers.filter(h => h).join(', ')}`,
        }));
        return createFailedResult(rawData.length);
      }
    }

    if (!/^[A-Z]+$/i.test(amountColumn)) {
      const amountColIndex = headers.findIndex(
        h => h?.toString().toLowerCase().trim() === amountColumn.toLowerCase().trim()
      );
      if (amountColIndex < 0) {
        addError(createFileProcessingError('INVALID_COLUMN_REFERENCE', {
          columnName: amountColumn,
          details: `Column "${amountColumn}" not found in headers`,
          suggestion: `Available columns: ${headers.filter(h => h).join(', ')}`,
        }));
        return createFailedResult(rawData.length);
      }
    }

    // VAT configuration
    const vatRate = vatConfig.vatRate || ISRAEL_VAT_RATE;
    const vatIncluded = vatConfig.vatIncluded;

    let totalGrossAmount = 0;
    let totalNetAmount = 0;
    let processedRows = 0;
    let skippedRows = 0;

    // Process each data row
    for (let i = dataStartRowIndex; i < dataEndRowIndex; i++) {
      const row = rawData[i];
      if (!row || row.length === 0) {
        skippedRows++;
        continue;
      }

      // Check if row should be skipped based on keywords
      if (shouldSkipRow(row, skipKeywords)) {
        skippedRows++;
        continue;
      }

      // Extract values
      const franchiseeValue = getCellValue(row, franchiseeColumn, headers);
      const amountValue = getCellValue(row, amountColumn, headers);
      const dateValue = dateColumn ? getCellValue(row, dateColumn, headers) : null;

      // Skip rows without franchisee name
      const franchiseeName = String(franchiseeValue || "").trim();
      if (!franchiseeName) {
        addWarning(createFileProcessingError('EMPTY_FRANCHISEE_NAME', {
          rowNumber: i + 1,
        }));
        skippedRows++;
        continue;
      }

      // Parse amount
      const originalAmount = parseNumericValue(amountValue);

      // Skip rows with zero or invalid amounts
      if (originalAmount === 0) {
        addWarning(createFileProcessingError('ZERO_AMOUNT', {
          rowNumber: i + 1,
          details: `Skipping row with zero amount for "${franchiseeName}"`,
          value: String(amountValue || ''),
        }));
        skippedRows++;
        continue;
      }

      // Warn about negative amounts but still process them
      if (originalAmount < 0) {
        addWarning(createFileProcessingError('NEGATIVE_AMOUNT', {
          rowNumber: i + 1,
          details: `Negative amount ${originalAmount} for "${franchiseeName}"`,
          value: String(originalAmount),
        }));
      }

      // Calculate gross and net amounts based on VAT configuration
      let grossAmount: number;
      let netAmount: number;

      if (vatIncluded) {
        // Amount includes VAT - calculate net (for commission calculation)
        grossAmount = originalAmount;
        netAmount = roundToTwoDecimals(calculateNetFromGross(originalAmount, vatRate));
      } else {
        // Amount does not include VAT - this is already the net amount
        netAmount = originalAmount;
        grossAmount = roundToTwoDecimals(calculateGrossFromNet(originalAmount, vatRate));
      }

      // Parse date
      const parsedDate = parseDateValue(dateValue);

      // Warn if date couldn't be parsed (but date column is configured)
      if (dateColumn && dateValue && !parsedDate) {
        addWarning(createFileProcessingError('INVALID_DATE', {
          rowNumber: i + 1,
          columnName: dateColumn,
          value: String(dateValue),
        }));
      }

      // Add to results
      data.push({
        franchisee: franchiseeName,
        date: parsedDate,
        grossAmount: roundToTwoDecimals(grossAmount),
        netAmount: roundToTwoDecimals(netAmount),
        originalAmount: roundToTwoDecimals(originalAmount),
        rowNumber: i + 1, // 1-indexed for display
      });

      totalGrossAmount += grossAmount;
      totalNetAmount += netAmount;
      processedRows++;
    }

    // Check if any rows were processed
    if (processedRows === 0 && data.length === 0) {
      addError(createCustomError(
        'NO_DATA_ROWS',
        'parsing',
        'error',
        'No data rows could be processed from the file',
        {
          details: `Total rows: ${rawData.length}, Header row: ${fileMapping.headerRow}, Data start row: ${fileMapping.dataStartRow}`,
          suggestion: 'Check that the data start row configuration is correct and the file contains valid data',
        }
      ));
      return createFailedResult(rawData.length);
    }

    return {
      success: true,
      data,
      errors,
      warnings,
      legacyErrors,
      legacyWarnings,
      summary: {
        totalRows: rawData.length,
        processedRows,
        skippedRows,
        totalGrossAmount: roundToTwoDecimals(totalGrossAmount),
        totalNetAmount: roundToTwoDecimals(totalNetAmount),
        vatAdjusted: vatIncluded,
      },
    };

  } catch (error) {
    addError(createFileProcessingError('SYSTEM_ERROR', {
      details: error instanceof Error ? error.message : 'Unknown error',
    }));
    return createFailedResult();
  }
}

/**
 * Process a supplier file and return commission-ready data
 * This function handles the complete flow from file parsing to VAT adjustment
 *
 * For suppliers with customParser: true in their fileMapping, this will use
 * the appropriate custom parser from the custom-parsers module.
 */
export async function processSupplierFile(
  fileBuffer: Buffer,
  fileMapping: SupplierFileMapping,
  vatIncluded: boolean,
  vatRate?: number,
  supplierCode?: string
): Promise<FileProcessingResult> {
  // Check if supplier requires custom parser
  if (fileMapping.customParser && supplierCode) {
    const { getCustomParser } = await import("./custom-parsers");
    const customParser = getCustomParser(supplierCode);

    if (customParser) {
      return customParser(fileBuffer);
    }
  }

  const vatConfig: VatConfig = {
    vatIncluded,
    vatRate,
  };

  return parseSupplierFile(fileBuffer, fileMapping, vatConfig);
}

/**
 * Calculate commission amount based on net amount
 * Commission is always calculated on the net amount (before VAT)
 */
export function calculateCommission(
  netAmount: number,
  commissionRate: number,
  commissionType: "percentage" | "per_item" = "percentage"
): number {
  if (commissionType === "percentage") {
    // Commission rate is a percentage (e.g., 5 means 5%)
    return roundToTwoDecimals(netAmount * (commissionRate / 100));
  }

  // For per_item, the commission rate is the fixed amount per item
  // This would need item count which isn't supported in current schema
  return roundToTwoDecimals(commissionRate);
}
