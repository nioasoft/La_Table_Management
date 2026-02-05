import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
  type AuthenticatedUser,
} from "@/lib/api-middleware";
import { getSupplierById } from "@/data-access/suppliers";
import { matchFranchiseeNamesFromFile } from "@/data-access/franchisees";
import { processSupplierFile, getCurrentVatRate } from "@/lib/file-processor";
import { requiresCustomParser } from "@/lib/custom-parsers";
import type { SupplierFileMapping, SettlementPeriodType } from "@/db/schema";
import type { MatcherConfig, FranchiseeMatchResult } from "@/lib/franchisee-matcher";
import {
  createFileProcessingError,
  determineProcessingStatus,
  aggregateUnmatchedFranchisees,
  formatErrorSummary,
  getStatusMessage,
  type FileProcessingError,
} from "@/lib/file-processing-errors";
import {
  logFileProcessing,
  createLogInputFromResults,
} from "@/data-access/fileProcessingLog";
import { createAuditContext } from "@/data-access/auditLog";
import { uploadDocument, generateEntityFileName } from "@/lib/storage";
import { formatDateAsLocal } from "@/lib/date-utils";
import { calculateBatchCommissions } from "@/data-access/commissions";
import { getOrCreateSettlementPeriodByPeriodKey } from "@/data-access/settlements";
import { getPeriodsForFrequency } from "@/lib/settlement-periods";
import { getVatProductNames, syncSupplierProducts } from "@/data-access/supplier-products";

interface RouteContext {
  params: Promise<{ supplierId: string }>;
}

/**
 * POST /api/suppliers/[supplierId]/process-file - Process an uploaded supplier file
 *
 * Accepts a file upload and processes it according to the supplier's file mapping configuration.
 * Applies VAT adjustment based on the supplier's vatIncluded setting.
 *
 * Request body should be multipart/form-data with:
 * - file: The file to process (Excel or CSV)
 * - vatRate (optional): Custom VAT rate (defaults to current Israel VAT rate from DB)
 *
 * Response includes:
 * - success: boolean
 * - data: Array of processed rows with:
 *   - franchisee: Franchisee name from file
 *   - date: Transaction date (if available)
 *   - grossAmount: Amount including VAT
 *   - netAmount: Amount before VAT (used for commission calculation)
 *   - originalAmount: Original amount from file
 *   - rowNumber: Source row number
 * - summary: Processing summary with totals
 * - errors: Any errors encountered
 * - warnings: Any warnings during processing
 */
export async function POST(request: NextRequest, context: RouteContext) {
  const startTime = Date.now();
  let supplierId: string | undefined;
  let supplierName: string | undefined;
  let fileName: string | undefined;
  let fileSize: number | undefined;
  let mimeType: string | undefined;
  let user: AuthenticatedUser | undefined;

  try {
    // Authenticate user
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    user = authResult.user;

    const params = await context.params;
    supplierId = params.supplierId;

    // Get supplier to check file mapping and VAT configuration
    const supplier = await getSupplierById(supplierId);
    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    supplierName = supplier.name;

    // Check if supplier has file mapping or custom parser configured
    const hasCustomParser = supplier.code && requiresCustomParser(supplier.code);
    if (!supplier.fileMapping && !hasCustomParser) {
      const error = createFileProcessingError('NO_FILE_MAPPING', {
        details: `Supplier "${supplier.name}" does not have file mapping or custom parser configured`,
      });

      // Log the configuration error
      try {
        const auditContext = createAuditContext(
          { user: { id: user.id, name: user.name, email: user.email } },
          request
        );
        await logFileProcessing(auditContext, {
          supplierId,
          supplierName: supplier.name,
          fileName: 'N/A',
          fileSize: 0,
          mimeType: undefined,
          status: 'failed',
          totalRows: 0,
          processedRows: 0,
          skippedRows: 0,
          totalGrossAmount: 0,
          totalNetAmount: 0,
          matchedFranchisees: 0,
          unmatchedFranchisees: 0,
          franchiseesNeedingReview: 0,
          errors: [error],
          warnings: [],
          unmatchedFranchiseeSummary: [],
          processingDurationMs: Date.now() - startTime,
          processedBy: user.id,
          processedByName: user.name,
          processedByEmail: user.email,
        });
      } catch (logError) {
        console.error("Failed to log file processing error:", logError);
      }

      return NextResponse.json(
        {
          error: "File mapping not configured",
          errorCode: error.code,
          errorCategory: error.category,
          message: error.message,
          suggestion: error.suggestion,
        },
        { status: 400 }
      );
    }

    // Parse the multipart form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const customVatRate = formData.get("vatRate") as string | null;
    const enableMatching = formData.get("enableMatching") !== "false"; // Default to true
    const matchConfigStr = formData.get("matchConfig") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    fileName = file.name;
    fileSize = file.size;
    mimeType = file.type || undefined;

    // Validate file type matches configured type (skip for custom parsers without fileMapping)
    const fileMapping = supplier.fileMapping as SupplierFileMapping | null;
    const mimeTypes: Record<string, string[]> = {
      xlsx: [
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        "application/vnd.ms-excel",
      ],
      // Also accept xlsx mime type for xls (client-side conversion for Vercel WAF)
      xls: [
        "application/vnd.ms-excel",
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
      ],
      csv: ["text/csv", "application/csv"],
      zip: [
        "application/zip",
        "application/x-zip-compressed",
        "application/vnd.ms-excel", // Allow XLS for suppliers with ZIP config (single file upload)
        "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet", // Allow XLSX for new multi-sheet format
      ],
    };

    // For custom parsers without fileMapping, default to accepting xlsx files
    const configuredFileType = fileMapping?.fileType || (hasCustomParser ? 'xlsx' : null);
    const allowedMimeTypes = configuredFileType ? (mimeTypes[configuredFileType] || []) : [];
    if (allowedMimeTypes.length > 0 && !allowedMimeTypes.includes(file.type) && file.type !== "") {
      const error = createFileProcessingError('FILE_TYPE_MISMATCH', {
        details: `Expected ${configuredFileType} file, got ${file.type}`,
      });

      // Log the file type error
      try {
        const auditContext = createAuditContext(
          { user: { id: user.id, name: user.name, email: user.email } },
          request
        );
        await logFileProcessing(auditContext, {
          supplierId,
          supplierName: supplier.name,
          fileName: file.name,
          fileSize: file.size,
          mimeType: file.type || undefined,
          status: 'failed',
          totalRows: 0,
          processedRows: 0,
          skippedRows: 0,
          totalGrossAmount: 0,
          totalNetAmount: 0,
          matchedFranchisees: 0,
          unmatchedFranchisees: 0,
          franchiseesNeedingReview: 0,
          errors: [error],
          warnings: [],
          unmatchedFranchiseeSummary: [],
          processingDurationMs: Date.now() - startTime,
          processedBy: user.id,
          processedByName: user.name,
          processedByEmail: user.email,
        });
      } catch (logError) {
        console.error("Failed to log file processing error:", logError);
      }

      return NextResponse.json(
        {
          error: "Invalid file type",
          errorCode: error.code,
          errorCategory: error.category,
          message: error.message,
          suggestion: error.suggestion,
          expected: configuredFileType,
          received: file.type,
        },
        { status: 400 }
      );
    }

    // Convert file to buffer
    const arrayBuffer = await file.arrayBuffer();
    const buffer = Buffer.from(arrayBuffer);

    // Determine VAT rate to use - get current rate from DB if not provided
    const currentVatRate = await getCurrentVatRate();
    const vatRate = customVatRate
      ? parseFloat(customVatRate) / 100 // Convert percentage to decimal
      : currentVatRate;

    // Load per-item VAT products for vatExempt suppliers (e.g., ale-ale)
    const vatProductNames = supplier.vatExempt
      ? await getVatProductNames(supplier.id)
      : undefined;

    // Process the file with VAT adjustment
    // Pass supplier code for custom parser lookup
    const result = await processSupplierFile(
      buffer,
      fileMapping,
      supplier.vatIncluded ?? false,
      vatRate,
      supplier.code ?? undefined,
      supplier.vatExempt ?? false,
      vatProductNames
    );

    // Sync extracted products to supplier_product table
    if (result.summary.extractedProducts?.length) {
      const syncResult = await syncSupplierProducts(
        supplier.id,
        result.summary.extractedProducts
      );
      if (syncResult.added.length > 0) {
        result.warnings.push(createFileProcessingError('SYSTEM_ERROR', {
          details: `נוספו ${syncResult.added.length} פריטים חדשים. יש לבדוק סטטוס מע"מ בכרטיס ספק.`,
        }));
      }
    }

    // Apply franchisee name matching if enabled
    let matchedData = result.data;
    let matchSummary = null;

    if (enableMatching && result.data.length > 0) {
      // Parse match config if provided
      let matchConfig: Partial<MatcherConfig> | undefined;
      if (matchConfigStr) {
        try {
          matchConfig = JSON.parse(matchConfigStr);
        } catch {
          // Ignore invalid JSON, use defaults
        }
      }

      // Match franchisee names from the processed file data
      const matchedResults = await matchFranchiseeNamesFromFile(
        result.data,
        matchConfig
      );

      matchedData = matchedResults;

      // Calculate match summary
      const matched = matchedResults.filter(
        r => r.matchResult.matchedFranchisee && !r.matchResult.requiresReview
      );
      const needsReview = matchedResults.filter(
        r => r.matchResult.matchedFranchisee && r.matchResult.requiresReview
      );
      const unmatched = matchedResults.filter(
        r => !r.matchResult.matchedFranchisee
      );

      const matchedWithScore = matchedResults.filter(
        r => r.matchResult.matchedFranchisee
      );
      const averageConfidence = matchedWithScore.length > 0
        ? matchedWithScore.reduce((sum, r) => sum + r.matchResult.confidence, 0) /
          matchedWithScore.length
        : 0;

      matchSummary = {
        total: matchedResults.length,
        matched: matched.length,
        needsReview: needsReview.length,
        unmatched: unmatched.length,
        averageConfidence: Math.trunc(averageConfidence * 100) / 100,
        unmatchedNames: [...new Set(unmatched.map(u => u.franchisee))],
        namesNeedingReview: needsReview.map(r => ({
          name: r.franchisee,
          suggestedMatch: r.matchResult.matchedFranchisee?.name,
          suggestedId: r.matchResult.matchedFranchisee?.id,
          confidence: r.matchResult.confidence,
        })),
      };

      // Add unmatched franchisee errors to the result
      for (const unmatchedItem of unmatched) {
        result.errors.push(createFileProcessingError('FRANCHISEE_NOT_FOUND', {
          rowNumber: unmatchedItem.rowNumber,
          value: unmatchedItem.franchisee,
          details: `Franchisee "${unmatchedItem.franchisee}" could not be matched`,
        }));
      }

      // Add low-confidence match warnings
      for (const reviewItem of needsReview) {
        result.warnings.push(createFileProcessingError('FRANCHISEE_LOW_CONFIDENCE', {
          rowNumber: reviewItem.rowNumber,
          value: reviewItem.franchisee,
          details: `Matched to "${reviewItem.matchResult.matchedFranchisee?.name}" with ${Math.round(reviewItem.matchResult.confidence * 100)}% confidence`,
        }));
      }
    }

    // Determine processing status
    const processingStatus = determineProcessingStatus(
      result.errors,
      result.warnings,
      result.summary.processedRows,
      matchSummary?.unmatched || 0,
      matchSummary?.needsReview || 0
    );

    // Aggregate unmatched franchisees for the log
    const unmatchedFranchiseeSummary = enableMatching && matchedData.length > 0
      ? aggregateUnmatchedFranchisees(
          matchedData.map(item => {
            const matchResultData = 'matchResult' in item ? item.matchResult : undefined;
            return {
              franchisee: item.franchisee,
              rowNumber: item.rowNumber,
              grossAmount: item.grossAmount,
              matchResult: matchResultData as {
                matchedFranchisee: { id: string; name: string } | null;
                confidence: number;
                alternatives?: Array<{ franchisee: { id: string; name: string }; confidence: number }>;
              } | undefined,
            };
          })
        )
      : [];

    // Log the file processing attempt
    const processingDurationMs = Date.now() - startTime;
    try {
      const auditContext = createAuditContext(
        { user: { id: user.id, name: user.name, email: user.email } },
        request
      );
      await logFileProcessing(auditContext, {
        supplierId,
        supplierName: supplier.name,
        fileName: file.name,
        fileSize: file.size,
        mimeType: file.type || undefined,
        status: processingStatus,
        totalRows: result.summary.totalRows,
        processedRows: result.summary.processedRows,
        skippedRows: result.summary.skippedRows,
        totalGrossAmount: result.summary.totalGrossAmount,
        totalNetAmount: result.summary.totalNetAmount,
        matchedFranchisees: matchSummary?.matched || 0,
        unmatchedFranchisees: matchSummary?.unmatched || 0,
        franchiseesNeedingReview: matchSummary?.needsReview || 0,
        errors: result.errors,
        warnings: result.warnings,
        unmatchedFranchiseeSummary,
        processingDurationMs,
        processedBy: user.id,
        processedByName: user.name,
        processedByEmail: user.email,
      });
    } catch (logError) {
      console.error("Failed to log file processing:", logError);
      // Don't fail the request if logging fails
    }

    // Upload the supplier file to Blob Storage for permanent storage
    // Extract earliest date from processed data for file naming
    let periodStartDate = formatDateAsLocal(new Date()); // Default to today
    const datesInFile = result.data
      .map(row => row.date)
      .filter((d): d is Date => d !== null);
    if (datesInFile.length > 0) {
      const earliest = datesInFile.reduce((min, d) => d < min ? d : min, datesInFile[0]);
      periodStartDate = formatDateAsLocal(earliest);
    }

    // Generate custom file name with supplier name and period
    let customFileName: string | undefined;
    try {
      customFileName = generateEntityFileName(
        supplier.name,
        periodStartDate,
        file.name
      );
    } catch (nameError) {
      console.warn("Failed to generate entity filename, using default:", nameError);
      // Will use default filename from uploadDocument
    }

    let fileUrl: string | undefined;
    let storedFileName: string | undefined;
    let storageUploadFailed = false;
    try {
      const uploadResult = await uploadDocument(
        buffer,
        file.name,
        file.type || "application/octet-stream",
        "supplier",
        supplierId,
        customFileName ? { customFileName } : undefined
      );
      fileUrl = uploadResult.url;
      storedFileName = uploadResult.fileName;
    } catch (uploadError) {
      console.error("Failed to upload supplier file to Blob Storage:", uploadError);
      storageUploadFailed = true;
      // Add warning about storage failure
      result.warnings.push(createFileProcessingError('SYSTEM_ERROR', {
        details: 'הקובץ עובד בהצלחה אך השמירה לאחסון נכשלה. ניתן לנסות שוב.',
      }));
    }

    // Auto-create commissions for matched franchisees
    let commissionsCreated: {
      success: boolean;
      totalCreated: number;
      totalFailed: number;
    } | undefined;

    if (matchSummary && matchSummary.matched > 0) {
      try {
        // Get or create settlement period based on supplier's settlement frequency
        const frequency = (supplier.settlementFrequency as SettlementPeriodType) || "quarterly";
        const fiscalYearStartMonth = supplier.fiscalYearStartMonth ?? 1;
        const periods = getPeriodsForFrequency(frequency, new Date(), 1, fiscalYearStartMonth);
        const currentPeriod = periods[0];

        if (currentPeriod) {
          const periodResult = await getOrCreateSettlementPeriodByPeriodKey(
            currentPeriod.key,
            user.id
          );

          if (periodResult) {
            // Build transactions list from matched data (only confirmed matches, not review-needed)
            // Type assertion needed because matchedData can be augmented with matchResult
            type MatchedDataItem = typeof matchedData[number] & { matchResult?: FranchiseeMatchResult };
            const transactionsToSave = (matchedData as MatchedDataItem[])
              .filter(item => {
                const matchResult = item.matchResult;
                return matchResult?.matchedFranchisee && !matchResult.requiresReview;
              })
              .map(item => {
                const matchResult = item.matchResult!;
                return {
                  franchiseeId: matchResult.matchedFranchisee!.id,
                  grossAmount: item.grossAmount,
                  netAmount: item.netAmount,
                  vatAdjusted: supplier.vatIncluded ?? false,
                };
              });

            if (transactionsToSave.length > 0) {
              const auditContext = createAuditContext(
                { user: { id: user.id, name: user.name, email: user.email } },
                request
              );

              const commissionsResult = await calculateBatchCommissions(
                {
                  supplierId,
                  periodStartDate: formatDateAsLocal(currentPeriod.startDate),
                  periodEndDate: formatDateAsLocal(currentPeriod.endDate),
                  settlementPeriodId: periodResult.settlementPeriod.id,
                  transactions: transactionsToSave,
                  createdBy: user.id,
                },
                auditContext
              );

              commissionsCreated = {
                success: commissionsResult.success,
                totalCreated: commissionsResult.totalCreated,
                totalFailed: commissionsResult.totalFailed,
              };

              // Add warning if some commissions failed
              if (commissionsResult.totalFailed > 0) {
                result.warnings.push(createFileProcessingError('SYSTEM_ERROR', {
                  details: `נוצרו ${commissionsResult.totalCreated} עמלות, ${commissionsResult.totalFailed} נכשלו`,
                }));
              }
            }
          }
        }
      } catch (commissionError) {
        console.error("Failed to auto-create commissions:", commissionError);
        result.warnings.push(createFileProcessingError('SYSTEM_ERROR', {
          details: 'הקובץ עובד בהצלחה אך יצירת העמלות האוטומטית נכשלה',
        }));
      }
    }

    // Return processing results
    return NextResponse.json({
      success: result.success,
      data: matchedData,
      summary: {
        ...result.summary,
        supplierName: supplier.name,
        supplierId: supplier.id,
        vatIncluded: supplier.vatIncluded ?? false,
        vatExempt: supplier.vatExempt ?? false,
        vatRate: vatRate * 100, // Return as percentage
        fileName: file.name,
        fileSize: file.size,
        periodStartDate, // Include extracted period start date
      },
      matchSummary,
      // Enhanced error information
      processingStatus,
      processingStatusMessage: getStatusMessage(processingStatus),
      errorSummary: formatErrorSummary(result.errors),
      errors: result.errors,
      warnings: result.warnings,
      // Legacy format for backwards compatibility
      legacyErrors: result.legacyErrors,
      legacyWarnings: result.legacyWarnings,
      // Unmatched franchisee summary
      unmatchedFranchiseeSummary,
      processingDurationMs,
      // File URL from Blob Storage (if upload succeeded)
      fileUrl,
      storedFileName,
      // Flag to indicate if storage upload failed (processing succeeded but file not saved)
      storageUploadFailed,
      // Auto-created commissions info
      commissionsCreated,
    });
  } catch (error) {
    console.error("Error processing supplier file:", error);

    // Log the system error if we have enough context
    if (supplierId && supplierName && user) {
      try {
        const auditContext = createAuditContext(
          { user: { id: user.id, name: user.name, email: user.email } },
          request
        );
        const systemError = createFileProcessingError('SYSTEM_ERROR', {
          details: error instanceof Error ? error.message : 'Unknown error',
        });
        await logFileProcessing(auditContext, {
          supplierId,
          supplierName,
          fileName: fileName || 'Unknown',
          fileSize: fileSize || 0,
          mimeType,
          status: 'failed',
          totalRows: 0,
          processedRows: 0,
          skippedRows: 0,
          totalGrossAmount: 0,
          totalNetAmount: 0,
          matchedFranchisees: 0,
          unmatchedFranchisees: 0,
          franchiseesNeedingReview: 0,
          errors: [systemError],
          warnings: [],
          unmatchedFranchiseeSummary: [],
          processingDurationMs: Date.now() - startTime,
          processedBy: user.id,
          processedByName: user.name,
          processedByEmail: user.email,
        });
      } catch (logError) {
        console.error("Failed to log system error:", logError);
      }
    }

    return NextResponse.json(
      {
        error: "Failed to process file",
        errorCode: "SYSTEM_ERROR",
        errorCategory: "system",
        message: error instanceof Error ? error.message : "Unknown error",
        suggestion: "Please try again or contact support if the issue persists",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/suppliers/[supplierId]/process-file - Get processing configuration
 *
 * Returns the file processing configuration for a supplier including:
 * - File mapping settings
 * - VAT configuration
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { supplierId } = await context.params;

    const supplier = await getSupplierById(supplierId);
    if (!supplier) {
      return NextResponse.json({ error: "Supplier not found" }, { status: 404 });
    }

    // Get current VAT rate from DB
    const currentVatRate = await getCurrentVatRate();

    return NextResponse.json({
      supplierId: supplier.id,
      supplierName: supplier.name,
      vatIncluded: supplier.vatIncluded ?? false,
      defaultVatRate: currentVatRate * 100, // Return as percentage
      fileMapping: supplier.fileMapping,
      hasFileMapping: !!supplier.fileMapping,
    });
  } catch (error) {
    console.error("Error fetching processing configuration:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
