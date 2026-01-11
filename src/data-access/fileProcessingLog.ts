import { database } from "@/db";
import {
  fileProcessingLog,
  supplier,
  user,
  type FileProcessingLog,
  type CreateFileProcessingLogData,
  type FileProcessingStatus,
} from "@/db/schema";
import { eq, desc, and, gte, lte, sql, inArray } from "drizzle-orm";
import type {
  FileProcessingError,
  UnmatchedFranchiseeSummary,
  ProcessedFileStatus,
} from "@/lib/file-processing-errors";
import {
  determineProcessingStatus,
  aggregateUnmatchedFranchisees,
} from "@/lib/file-processing-errors";
import { logAuditEvent, type AuditContext } from "./auditLog";

// ============================================================================
// TYPES
// ============================================================================

/**
 * Extended file processing log with supplier information
 */
export type FileProcessingLogWithSupplier = FileProcessingLog & {
  supplier?: { id: string; name: string } | null;
  processedByUser?: { name: string; email: string } | null;
};

/**
 * Options for querying file processing logs
 */
export interface FileProcessingLogQueryOptions {
  supplierId?: string;
  status?: FileProcessingStatus | FileProcessingStatus[];
  processedBy?: string;
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

/**
 * Summary statistics for file processing
 */
export interface FileProcessingStats {
  total: number;
  byStatus: Record<FileProcessingStatus, number>;
  totalErrors: number;
  totalWarnings: number;
  totalProcessedRows: number;
  totalUnmatchedFranchisees: number;
}

/**
 * Input for creating a file processing log entry
 */
export interface CreateFileProcessingLogInput {
  supplierId: string;
  supplierName: string;
  fileName: string;
  fileSize: number;
  mimeType?: string;
  status: ProcessedFileStatus;
  totalRows: number;
  processedRows: number;
  skippedRows: number;
  totalGrossAmount: number;
  totalNetAmount: number;
  matchedFranchisees: number;
  unmatchedFranchisees: number;
  franchiseesNeedingReview: number;
  errors: FileProcessingError[];
  warnings: FileProcessingError[];
  unmatchedFranchiseeSummary: UnmatchedFranchiseeSummary[];
  processingDurationMs: number;
  processedBy?: string;
  processedByName?: string;
  processedByEmail?: string;
  metadata?: Record<string, unknown>;
}

// ============================================================================
// CORE FUNCTIONS
// ============================================================================

/**
 * Create a new file processing log entry
 */
export async function createFileProcessingLogEntry(
  input: CreateFileProcessingLogInput
): Promise<FileProcessingLog> {
  const id = crypto.randomUUID();

  const [entry] = (await database
    .insert(fileProcessingLog)
    .values({
      id,
      supplierId: input.supplierId,
      supplierName: input.supplierName,
      fileName: input.fileName,
      fileSize: input.fileSize,
      mimeType: input.mimeType,
      status: input.status as FileProcessingStatus,
      totalRows: input.totalRows,
      processedRows: input.processedRows,
      skippedRows: input.skippedRows,
      errorCount: input.errors.length,
      warningCount: input.warnings.length,
      totalGrossAmount: input.totalGrossAmount.toString(),
      totalNetAmount: input.totalNetAmount.toString(),
      matchedFranchisees: input.matchedFranchisees,
      unmatchedFranchisees: input.unmatchedFranchisees,
      franchiseesNeedingReview: input.franchiseesNeedingReview,
      errors: input.errors,
      warnings: input.warnings,
      unmatchedFranchiseeSummary: input.unmatchedFranchiseeSummary,
      processingDurationMs: input.processingDurationMs,
      processedBy: input.processedBy,
      processedByName: input.processedByName,
      processedByEmail: input.processedByEmail,
      metadata: input.metadata,
      processedAt: new Date(),
      createdAt: new Date(),
    })
    .returning()) as unknown as FileProcessingLog[];

  return entry;
}

/**
 * Get file processing log by ID
 */
export async function getFileProcessingLogById(
  id: string
): Promise<FileProcessingLogWithSupplier | null> {
  const results = await database
    .select({
      log: fileProcessingLog,
      supplierName: supplier.name,
      supplierId: supplier.id,
      processedByUserName: user.name,
      processedByUserEmail: user.email,
    })
    .from(fileProcessingLog)
    .leftJoin(supplier, eq(fileProcessingLog.supplierId, supplier.id))
    .leftJoin(user, eq(fileProcessingLog.processedBy, user.id))
    .where(eq(fileProcessingLog.id, id))
    .limit(1);

  if (results.length === 0) return null;

  const row = results[0];
  return {
    ...row.log,
    supplier: row.supplierId ? { id: row.supplierId, name: row.supplierName! } : null,
    processedByUser: row.processedByUserName
      ? { name: row.processedByUserName, email: row.processedByUserEmail! }
      : null,
  };
}

/**
 * Get file processing logs with filtering options
 */
export async function getFileProcessingLogs(
  options: FileProcessingLogQueryOptions = {}
): Promise<FileProcessingLogWithSupplier[]> {
  const conditions = [];

  if (options.supplierId) {
    conditions.push(eq(fileProcessingLog.supplierId, options.supplierId));
  }

  if (options.status) {
    if (Array.isArray(options.status)) {
      conditions.push(inArray(fileProcessingLog.status, options.status));
    } else {
      conditions.push(eq(fileProcessingLog.status, options.status));
    }
  }

  if (options.processedBy) {
    conditions.push(eq(fileProcessingLog.processedBy, options.processedBy));
  }

  if (options.startDate) {
    conditions.push(gte(fileProcessingLog.processedAt, options.startDate));
  }

  if (options.endDate) {
    conditions.push(lte(fileProcessingLog.processedAt, options.endDate));
  }

  const query = database
    .select({
      log: fileProcessingLog,
      supplierName: supplier.name,
      supplierId: supplier.id,
      processedByUserName: user.name,
      processedByUserEmail: user.email,
    })
    .from(fileProcessingLog)
    .leftJoin(supplier, eq(fileProcessingLog.supplierId, supplier.id))
    .leftJoin(user, eq(fileProcessingLog.processedBy, user.id))
    .orderBy(desc(fileProcessingLog.processedAt));

  if (conditions.length > 0) {
    query.where(and(...conditions));
  }

  if (options.limit) {
    query.limit(options.limit);
  }

  if (options.offset) {
    query.offset(options.offset);
  }

  const results = await query;

  return results.map((row) => ({
    ...row.log,
    supplier: row.supplierId ? { id: row.supplierId, name: row.supplierName! } : null,
    processedByUser: row.processedByUserName
      ? { name: row.processedByUserName, email: row.processedByUserEmail! }
      : null,
  }));
}

/**
 * Get file processing logs for a specific supplier
 */
export async function getSupplierFileProcessingLogs(
  supplierId: string,
  limit: number = 50
): Promise<FileProcessingLogWithSupplier[]> {
  return getFileProcessingLogs({ supplierId, limit });
}

/**
 * Get recent file processing logs
 */
export async function getRecentFileProcessingLogs(
  limit: number = 100
): Promise<FileProcessingLogWithSupplier[]> {
  return getFileProcessingLogs({ limit });
}

/**
 * Get file processing logs that are flagged (need review)
 */
export async function getFlaggedFileProcessingLogs(
  limit: number = 100
): Promise<FileProcessingLogWithSupplier[]> {
  return getFileProcessingLogs({ status: "flagged", limit });
}

/**
 * Get file processing logs that failed
 */
export async function getFailedFileProcessingLogs(
  limit: number = 100
): Promise<FileProcessingLogWithSupplier[]> {
  return getFileProcessingLogs({ status: "failed", limit });
}

/**
 * Get file processing statistics
 */
export async function getFileProcessingStats(
  supplierId?: string,
  startDate?: Date,
  endDate?: Date
): Promise<FileProcessingStats> {
  const options: FileProcessingLogQueryOptions = { limit: 10000 };
  if (supplierId) options.supplierId = supplierId;
  if (startDate) options.startDate = startDate;
  if (endDate) options.endDate = endDate;

  const logs = await getFileProcessingLogs(options);

  const stats: FileProcessingStats = {
    total: logs.length,
    byStatus: {
      success: 0,
      partial_success: 0,
      failed: 0,
      flagged: 0,
    },
    totalErrors: 0,
    totalWarnings: 0,
    totalProcessedRows: 0,
    totalUnmatchedFranchisees: 0,
  };

  for (const log of logs) {
    stats.byStatus[log.status as FileProcessingStatus]++;
    stats.totalErrors += log.errorCount || 0;
    stats.totalWarnings += log.warningCount || 0;
    stats.totalProcessedRows += log.processedRows || 0;
    stats.totalUnmatchedFranchisees += log.unmatchedFranchisees || 0;
  }

  return stats;
}

// ============================================================================
// SPECIALIZED LOG FUNCTIONS WITH AUDIT TRAIL
// ============================================================================

/**
 * Log a file processing attempt with audit trail
 */
export async function logFileProcessing(
  context: AuditContext | null,
  input: CreateFileProcessingLogInput
): Promise<FileProcessingLog> {
  // Create the file processing log entry
  const logEntry = await createFileProcessingLogEntry(input);

  // Create audit log entry if context is provided
  if (context) {
    const auditAction =
      input.status === "failed"
        ? "file_process_error"
        : input.status === "flagged"
        ? "file_process_flagged"
        : "file_process";

    await logAuditEvent(
      context,
      auditAction as "file_process" | "file_process_error" | "file_process_flagged",
      "file_processing",
      logEntry.id,
      {
        entityName: input.fileName,
        afterValue: {
          status: input.status,
          supplierId: input.supplierId,
          supplierName: input.supplierName,
          totalRows: input.totalRows,
          processedRows: input.processedRows,
          errorCount: input.errors.length,
          warningCount: input.warnings.length,
          unmatchedFranchisees: input.unmatchedFranchisees,
        },
        metadata: {
          fileName: input.fileName,
          fileSize: input.fileSize,
          processingDurationMs: input.processingDurationMs,
        },
      }
    );
  }

  return logEntry;
}

/**
 * Get unmatched franchisees across all recent file processing logs
 */
export async function getRecentUnmatchedFranchisees(
  supplierId?: string,
  limit: number = 100
): Promise<
  Array<{
    name: string;
    totalOccurrences: number;
    totalAmount: number;
    files: Array<{
      logId: string;
      fileName: string;
      processedAt: Date;
      occurrences: number;
    }>;
    suggestedMatches?: Array<{
      franchiseeName: string;
      franchiseeId: string;
      confidence: number;
    }>;
  }>
> {
  const logs = await getFileProcessingLogs({
    supplierId,
    status: ["flagged", "partial_success"],
    limit,
  });

  // Aggregate unmatched franchisees across files
  const aggregated: Map<
    string,
    {
      name: string;
      totalOccurrences: number;
      totalAmount: number;
      files: Array<{
        logId: string;
        fileName: string;
        processedAt: Date;
        occurrences: number;
      }>;
      suggestedMatches?: Array<{
        franchiseeName: string;
        franchiseeId: string;
        confidence: number;
      }>;
    }
  > = new Map();

  for (const log of logs) {
    const summary = log.unmatchedFranchiseeSummary || [];
    for (const item of summary) {
      const existing = aggregated.get(item.name);
      if (existing) {
        existing.totalOccurrences += item.occurrences;
        existing.totalAmount += item.totalAmount;
        existing.files.push({
          logId: log.id,
          fileName: log.fileName,
          processedAt: log.processedAt,
          occurrences: item.occurrences,
        });
        // Update suggested matches if not present
        if (!existing.suggestedMatches && item.suggestedMatches) {
          existing.suggestedMatches = item.suggestedMatches;
        }
      } else {
        aggregated.set(item.name, {
          name: item.name,
          totalOccurrences: item.occurrences,
          totalAmount: item.totalAmount,
          files: [
            {
              logId: log.id,
              fileName: log.fileName,
              processedAt: log.processedAt,
              occurrences: item.occurrences,
            },
          ],
          suggestedMatches: item.suggestedMatches,
        });
      }
    }
  }

  return Array.from(aggregated.values()).sort(
    (a, b) => b.totalOccurrences - a.totalOccurrences
  );
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Create a file processing log input from processing results
 */
export function createLogInputFromResults(
  supplierId: string,
  supplierName: string,
  fileName: string,
  fileSize: number,
  mimeType: string | undefined,
  processingResult: {
    success: boolean;
    data: Array<{
      franchisee: string;
      rowNumber: number;
      grossAmount: number;
      matchResult?: {
        matchedFranchisee: { id: string; name: string } | null;
        confidence: number;
        requiresReview?: boolean;
        alternatives?: Array<{ franchisee: { id: string; name: string }; confidence: number }>;
      };
    }>;
    errors: FileProcessingError[];
    warnings: FileProcessingError[];
    summary: {
      totalRows: number;
      processedRows: number;
      skippedRows: number;
      totalGrossAmount: number;
      totalNetAmount: number;
    };
  },
  matchSummary: {
    matched: number;
    needsReview: number;
    unmatched: number;
  } | null,
  processingDurationMs: number,
  userContext?: {
    userId: string;
    userName: string;
    userEmail: string;
  }
): CreateFileProcessingLogInput {
  // Determine processing status
  const status = determineProcessingStatus(
    processingResult.errors,
    processingResult.warnings,
    processingResult.summary.processedRows,
    matchSummary?.unmatched || 0,
    matchSummary?.needsReview || 0
  );

  // Aggregate unmatched franchisees
  const unmatchedFranchiseeSummary = aggregateUnmatchedFranchisees(processingResult.data);

  return {
    supplierId,
    supplierName,
    fileName,
    fileSize,
    mimeType,
    status,
    totalRows: processingResult.summary.totalRows,
    processedRows: processingResult.summary.processedRows,
    skippedRows: processingResult.summary.skippedRows,
    totalGrossAmount: processingResult.summary.totalGrossAmount,
    totalNetAmount: processingResult.summary.totalNetAmount,
    matchedFranchisees: matchSummary?.matched || 0,
    unmatchedFranchisees: matchSummary?.unmatched || 0,
    franchiseesNeedingReview: matchSummary?.needsReview || 0,
    errors: processingResult.errors,
    warnings: processingResult.warnings,
    unmatchedFranchiseeSummary,
    processingDurationMs,
    processedBy: userContext?.userId,
    processedByName: userContext?.userName,
    processedByEmail: userContext?.userEmail,
  };
}
