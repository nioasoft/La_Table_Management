/**
 * File Processing Error Handling System
 *
 * This module provides comprehensive error categorization, tracking, and
 * reporting for file processing operations in the supplier file import flow.
 */

// ============================================================================
// ERROR CATEGORY TYPES
// ============================================================================

/**
 * Categories of file processing errors
 */
export type FileProcessingErrorCategory =
  | 'file_format'        // Wrong file format, corrupted file, unreadable file
  | 'missing_columns'    // Required columns not found in file
  | 'invalid_data'       // Data in cells doesn't match expected format
  | 'unmatched_franchisee' // Franchisee name from file couldn't be matched
  | 'configuration'      // Supplier file mapping not configured or invalid
  | 'parsing'            // General parsing errors
  | 'validation'         // Data validation errors (e.g., negative amounts)
  | 'system';            // System/infrastructure errors

/**
 * Severity levels for file processing errors
 */
export type FileProcessingErrorSeverity =
  | 'error'    // Processing cannot continue
  | 'warning'  // Processing can continue but data may be incomplete
  | 'info';    // Informational (e.g., skipped rows)

/**
 * Status of a processed file
 */
export type ProcessedFileStatus =
  | 'success'           // File processed successfully with no errors
  | 'partial_success'   // File processed with some warnings/skipped rows
  | 'failed'            // File processing failed
  | 'flagged';          // File processed but flagged for review

// ============================================================================
// ERROR DETAIL INTERFACES
// ============================================================================

/**
 * Detailed error information for a file processing error
 */
export interface FileProcessingError {
  code: string;                           // Unique error code (e.g., 'ERR_MISSING_COLUMN')
  category: FileProcessingErrorCategory;
  severity: FileProcessingErrorSeverity;
  message: string;                        // Human-readable error message
  details?: string;                       // Additional details/context
  rowNumber?: number;                     // Row number where error occurred (if applicable)
  columnName?: string;                    // Column name related to error (if applicable)
  value?: string;                         // The problematic value (if applicable)
  suggestion?: string;                    // Suggested fix for the user
}

/**
 * Summary of unmatched franchisees from file processing
 */
export interface UnmatchedFranchiseeSummary {
  name: string;
  occurrences: number;
  rowNumbers: number[];
  totalAmount: number;
  suggestedMatches?: Array<{
    franchiseeName: string;
    franchiseeId: string;
    confidence: number;
  }>;
}

/**
 * Complete file processing log entry
 */
export interface FileProcessingLogEntry {
  id?: string;
  supplierId: string;
  supplierName: string;
  fileName: string;
  fileSize: number;
  mimeType: string;

  // Processing status
  status: ProcessedFileStatus;

  // Statistics
  totalRows: number;
  processedRows: number;
  skippedRows: number;
  errorCount: number;
  warningCount: number;

  // Amounts
  totalGrossAmount: number;
  totalNetAmount: number;

  // Matching summary
  matchedFranchisees: number;
  unmatchedFranchisees: number;
  franchiseesNeedingReview: number;

  // Error details
  errors: FileProcessingError[];
  warnings: FileProcessingError[];
  unmatchedFranchiseeSummary: UnmatchedFranchiseeSummary[];

  // Timestamps
  processedAt: Date;
  processingDurationMs: number;

  // User context
  processedBy?: string;
  processedByName?: string;
  processedByEmail?: string;

  // Additional metadata
  metadata?: Record<string, unknown>;
}

// ============================================================================
// ERROR CODE DEFINITIONS
// ============================================================================

/**
 * Predefined error codes with their categories and default messages
 */
export const FILE_PROCESSING_ERROR_CODES = {
  // File format errors
  FILE_EMPTY: {
    code: 'FILE_EMPTY',
    category: 'file_format' as const,
    severity: 'error' as const,
    message: 'The uploaded file is empty',
    suggestion: 'Please upload a file that contains data',
  },
  FILE_CORRUPTED: {
    code: 'FILE_CORRUPTED',
    category: 'file_format' as const,
    severity: 'error' as const,
    message: 'The file appears to be corrupted or unreadable',
    suggestion: 'Try re-exporting the file from the source application',
  },
  FILE_TYPE_MISMATCH: {
    code: 'FILE_TYPE_MISMATCH',
    category: 'file_format' as const,
    severity: 'error' as const,
    message: 'The file type does not match the expected format',
    suggestion: 'Please upload a file in the correct format as configured for this supplier',
  },
  NO_WORKSHEETS: {
    code: 'NO_WORKSHEETS',
    category: 'file_format' as const,
    severity: 'error' as const,
    message: 'No worksheets found in the Excel file',
    suggestion: 'Ensure the file contains at least one worksheet with data',
  },

  // Missing columns errors
  MISSING_FRANCHISEE_COLUMN: {
    code: 'MISSING_FRANCHISEE_COLUMN',
    category: 'missing_columns' as const,
    severity: 'error' as const,
    message: 'Franchisee name column not found',
    suggestion: 'Check that the file contains the franchisee column as configured',
  },
  MISSING_AMOUNT_COLUMN: {
    code: 'MISSING_AMOUNT_COLUMN',
    category: 'missing_columns' as const,
    severity: 'error' as const,
    message: 'Amount column not found',
    suggestion: 'Check that the file contains the amount column as configured',
  },
  MISSING_DATE_COLUMN: {
    code: 'MISSING_DATE_COLUMN',
    category: 'missing_columns' as const,
    severity: 'warning' as const,
    message: 'Date column not found',
    suggestion: 'Date column is optional but recommended for accurate tracking',
  },
  HEADER_ROW_NOT_FOUND: {
    code: 'HEADER_ROW_NOT_FOUND',
    category: 'missing_columns' as const,
    severity: 'error' as const,
    message: 'Header row not found at the configured position',
    suggestion: 'Verify the header row number in the supplier configuration',
  },

  // Invalid data errors
  INVALID_AMOUNT: {
    code: 'INVALID_AMOUNT',
    category: 'invalid_data' as const,
    severity: 'warning' as const,
    message: 'Invalid or unreadable amount value',
    suggestion: 'Check that amount values are in a valid numeric format',
  },
  ZERO_AMOUNT: {
    code: 'ZERO_AMOUNT',
    category: 'invalid_data' as const,
    severity: 'info' as const,
    message: 'Row skipped due to zero amount',
    suggestion: 'Rows with zero amounts are skipped automatically',
  },
  NEGATIVE_AMOUNT: {
    code: 'NEGATIVE_AMOUNT',
    category: 'invalid_data' as const,
    severity: 'warning' as const,
    message: 'Negative amount detected',
    suggestion: 'Verify if negative amounts are intentional (refunds/credits)',
  },
  INVALID_DATE: {
    code: 'INVALID_DATE',
    category: 'invalid_data' as const,
    severity: 'warning' as const,
    message: 'Invalid or unreadable date value',
    suggestion: 'Check that dates are in a recognized format (DD/MM/YYYY, YYYY-MM-DD, etc.)',
  },
  EMPTY_FRANCHISEE_NAME: {
    code: 'EMPTY_FRANCHISEE_NAME',
    category: 'invalid_data' as const,
    severity: 'info' as const,
    message: 'Row skipped due to empty franchisee name',
    suggestion: 'Ensure all data rows have a franchisee name',
  },

  // Unmatched franchisee errors
  FRANCHISEE_NOT_FOUND: {
    code: 'FRANCHISEE_NOT_FOUND',
    category: 'unmatched_franchisee' as const,
    severity: 'warning' as const,
    message: 'Franchisee name could not be matched to any existing franchisee',
    suggestion: 'Review the name and either add it as an alias or create a new franchisee',
  },
  FRANCHISEE_LOW_CONFIDENCE: {
    code: 'FRANCHISEE_LOW_CONFIDENCE',
    category: 'unmatched_franchisee' as const,
    severity: 'warning' as const,
    message: 'Franchisee name matched with low confidence',
    suggestion: 'Please verify the suggested match is correct',
  },
  MULTIPLE_FRANCHISEE_MATCHES: {
    code: 'MULTIPLE_FRANCHISEE_MATCHES',
    category: 'unmatched_franchisee' as const,
    severity: 'warning' as const,
    message: 'Multiple franchisees could match this name',
    suggestion: 'Review the alternatives and select the correct match',
  },

  // Configuration errors
  NO_FILE_MAPPING: {
    code: 'NO_FILE_MAPPING',
    category: 'configuration' as const,
    severity: 'error' as const,
    message: 'File mapping not configured for this supplier',
    suggestion: 'Configure the file mapping in the supplier settings before processing files',
  },
  INVALID_FILE_MAPPING: {
    code: 'INVALID_FILE_MAPPING',
    category: 'configuration' as const,
    severity: 'error' as const,
    message: 'File mapping configuration is invalid or incomplete',
    suggestion: 'Review and fix the file mapping configuration for this supplier',
  },
  INVALID_COLUMN_REFERENCE: {
    code: 'INVALID_COLUMN_REFERENCE',
    category: 'configuration' as const,
    severity: 'error' as const,
    message: 'Column reference in configuration is invalid',
    suggestion: 'Verify the column mappings use valid column letters or header names',
  },

  // Parsing errors
  PARSE_ERROR: {
    code: 'PARSE_ERROR',
    category: 'parsing' as const,
    severity: 'error' as const,
    message: 'Failed to parse the file',
    suggestion: 'Try re-exporting the file or contact support if the issue persists',
  },
  ROW_PARSE_ERROR: {
    code: 'ROW_PARSE_ERROR',
    category: 'parsing' as const,
    severity: 'warning' as const,
    message: 'Failed to parse a row',
    suggestion: 'Check the data in the specified row for any formatting issues',
  },

  // System errors
  SYSTEM_ERROR: {
    code: 'SYSTEM_ERROR',
    category: 'system' as const,
    severity: 'error' as const,
    message: 'An unexpected system error occurred',
    suggestion: 'Please try again or contact support if the issue persists',
  },
  TIMEOUT: {
    code: 'TIMEOUT',
    category: 'system' as const,
    severity: 'error' as const,
    message: 'File processing timed out',
    suggestion: 'The file may be too large. Try splitting it into smaller files',
  },
} as const;

// ============================================================================
// ERROR FACTORY FUNCTIONS
// ============================================================================

/**
 * Create a file processing error with all required fields
 */
export function createFileProcessingError(
  codeKey: keyof typeof FILE_PROCESSING_ERROR_CODES,
  overrides?: Partial<FileProcessingError>
): FileProcessingError {
  const baseError = FILE_PROCESSING_ERROR_CODES[codeKey];
  return {
    code: baseError.code,
    category: baseError.category,
    severity: baseError.severity,
    message: overrides?.message || baseError.message,
    suggestion: overrides?.suggestion || baseError.suggestion,
    details: overrides?.details,
    rowNumber: overrides?.rowNumber,
    columnName: overrides?.columnName,
    value: overrides?.value,
  };
}

/**
 * Create a custom file processing error
 */
export function createCustomError(
  code: string,
  category: FileProcessingErrorCategory,
  severity: FileProcessingErrorSeverity,
  message: string,
  options?: Partial<Omit<FileProcessingError, 'code' | 'category' | 'severity' | 'message'>>
): FileProcessingError {
  return {
    code,
    category,
    severity,
    message,
    ...options,
  };
}

// ============================================================================
// ERROR FORMATTING UTILITIES
// ============================================================================

/**
 * Format a file processing error for display to users
 */
export function formatErrorForDisplay(error: FileProcessingError): string {
  let message = error.message;

  if (error.rowNumber) {
    message = `Row ${error.rowNumber}: ${message}`;
  }

  if (error.columnName) {
    message += ` (Column: ${error.columnName})`;
  }

  if (error.value) {
    message += ` - Value: "${error.value}"`;
  }

  return message;
}

/**
 * Format multiple errors into a summary string
 */
export function formatErrorSummary(errors: FileProcessingError[]): string {
  if (errors.length === 0) return 'No errors';

  const byCategory = errors.reduce((acc, error) => {
    acc[error.category] = (acc[error.category] || 0) + 1;
    return acc;
  }, {} as Record<string, number>);

  const parts = Object.entries(byCategory).map(
    ([category, count]) => `${count} ${category.replace('_', ' ')} error${count > 1 ? 's' : ''}`
  );

  return parts.join(', ');
}

/**
 * Get user-friendly category name
 */
export function getCategoryDisplayName(category: FileProcessingErrorCategory): string {
  const displayNames: Record<FileProcessingErrorCategory, string> = {
    file_format: 'File Format',
    missing_columns: 'Missing Columns',
    invalid_data: 'Invalid Data',
    unmatched_franchisee: 'Unmatched Franchisee',
    configuration: 'Configuration',
    parsing: 'Parsing',
    validation: 'Validation',
    system: 'System',
  };
  return displayNames[category];
}

/**
 * Get user-friendly severity name
 */
export function getSeverityDisplayName(severity: FileProcessingErrorSeverity): string {
  const displayNames: Record<FileProcessingErrorSeverity, string> = {
    error: 'Error',
    warning: 'Warning',
    info: 'Info',
  };
  return displayNames[severity];
}

// ============================================================================
// STATUS DETERMINATION
// ============================================================================

/**
 * Determine the overall status of file processing based on errors and results
 */
export function determineProcessingStatus(
  errors: FileProcessingError[],
  warnings: FileProcessingError[],
  processedRows: number,
  unmatchedCount: number,
  needsReviewCount: number
): ProcessedFileStatus {
  // Check for critical errors that prevent processing
  const criticalErrors = errors.filter(e => e.severity === 'error');
  if (criticalErrors.length > 0 || processedRows === 0) {
    return 'failed';
  }

  // Check if flagging is needed (unmatched franchisees or items needing review)
  if (unmatchedCount > 0 || needsReviewCount > 0) {
    return 'flagged';
  }

  // Check for warnings
  if (warnings.length > 0) {
    return 'partial_success';
  }

  return 'success';
}

/**
 * Get human-readable status message
 */
export function getStatusMessage(status: ProcessedFileStatus): string {
  const messages: Record<ProcessedFileStatus, string> = {
    success: 'File processed successfully',
    partial_success: 'File processed with some warnings',
    failed: 'File processing failed',
    flagged: 'File processed but requires review',
  };
  return messages[status];
}

// ============================================================================
// ERROR AGGREGATION
// ============================================================================

/**
 * Aggregate unmatched franchisee errors into a summary
 */
export function aggregateUnmatchedFranchisees(
  data: Array<{
    franchisee: string;
    rowNumber: number;
    grossAmount: number;
    matchResult?: {
      matchedFranchisee: { id: string; name: string } | null;
      confidence: number;
      alternatives?: Array<{ franchisee: { id: string; name: string }; confidence: number }>;
    };
  }>
): UnmatchedFranchiseeSummary[] {
  const summary: Map<string, UnmatchedFranchiseeSummary> = new Map();

  for (const item of data) {
    if (!item.matchResult?.matchedFranchisee) {
      const existing = summary.get(item.franchisee);
      if (existing) {
        existing.occurrences++;
        existing.rowNumbers.push(item.rowNumber);
        existing.totalAmount += item.grossAmount;
      } else {
        summary.set(item.franchisee, {
          name: item.franchisee,
          occurrences: 1,
          rowNumbers: [item.rowNumber],
          totalAmount: item.grossAmount,
          suggestedMatches: item.matchResult?.alternatives?.map(a => ({
            franchiseeName: a.franchisee.name,
            franchiseeId: a.franchisee.id,
            confidence: a.confidence,
          })),
        });
      }
    }
  }

  return Array.from(summary.values()).sort((a, b) => b.occurrences - a.occurrences);
}
