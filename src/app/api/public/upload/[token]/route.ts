import { NextRequest, NextResponse } from "next/server";
import {
  getUploadLinkByToken,
  isUploadLinkValid,
  createUploadedFile,
  getUploadedFilesCount,
  markUploadLinkAsUsed,
  updateUploadedFileProcessingStatus,
} from "@/data-access/uploadLinks";
import { getSuppliers, getSupplierById } from "@/data-access/suppliers";
import { matchBkmvSuppliers } from "@/lib/supplier-matcher";
import { getFranchiseeByCompanyId, matchFranchiseeNamesFromFile } from "@/data-access/franchisees";
import type { BkmvProcessingResult, SupplierFileMapping, SupplierFileProcessingResult } from "@/db/schema";
import {
  uploadDocument,
  generateEntityFileName,
  isAllowedFileType,
  isFileSizeValid,
  getMaxFileSize,
  getAllowedMimeTypes,
} from "@/lib/storage";
import { validateFileType } from "@/lib/file-validation";
import { randomUUID } from "crypto";
import { notifySuperUsersAboutUpload } from "@/lib/notifications";
import { isBkmvDataFile, parseBkmvData, extractDateRange } from "@/lib/bkmvdata-parser";
import { processFranchiseeBkmvData } from "@/data-access/crossReferences";
import { getBlacklistedNamesSet } from "@/data-access/bkmvBlacklist";
import { formatDateAsLocal } from "@/lib/date-utils";
import { processSupplierFile, getCurrentVatRate } from "@/lib/file-processor";
import { requiresCustomParser } from "@/lib/custom-parsers";
import { createSupplierFileUpload } from "@/data-access/supplier-file-uploads";

/**
 * GET /api/public/upload/[token] - Get upload link info (public, no auth required)
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // Get upload link by token
    const link = await getUploadLinkByToken(token);

    if (!link) {
      return NextResponse.json(
        { error: "קישור לא נמצא", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    // Check if link is valid
    const validation = isUploadLinkValid(link);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.reason, code: "INVALID_LINK" },
        { status: 400 }
      );
    }

    // Parse allowed file types
    const allowedFileTypes = link.allowedFileTypes
      ? link.allowedFileTypes.split(",").map((t) => t.trim())
      : getAllowedMimeTypes();

    // Return public info about the upload link
    return NextResponse.json({
      uploadLink: {
        id: link.id,
        name: link.name,
        description: link.description,
        entityType: link.entityType,
        entityName: link.entityName,
        allowedFileTypes,
        maxFileSize: link.maxFileSize || getMaxFileSize(),
        maxFiles: link.maxFiles,
        filesUploaded: link.filesUploaded || 0,
        expiresAt: link.expiresAt,
      },
    });
  } catch (error) {
    console.error("Error fetching upload link:", error);
    return NextResponse.json(
      { error: "שגיאה פנימית", code: "INTERNAL_ERROR" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/public/upload/[token] - Upload file to an upload link (public, no auth required)
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ token: string }> }
) {
  try {
    const { token } = await params;

    // Get upload link by token
    const link = await getUploadLinkByToken(token);

    if (!link) {
      return NextResponse.json(
        { error: "קישור לא נמצא", code: "NOT_FOUND" },
        { status: 404 }
      );
    }

    // Check if link is valid
    const validation = isUploadLinkValid(link);
    if (!validation.valid) {
      return NextResponse.json(
        { error: validation.reason, code: "INVALID_LINK" },
        { status: 400 }
      );
    }

    // Check if max files limit reached
    const currentFilesCount = await getUploadedFilesCount(link.id);
    if (currentFilesCount >= link.maxFiles) {
      return NextResponse.json(
        { error: "הגעת למספר הקבצים המקסימלי המותר", code: "MAX_FILES_REACHED" },
        { status: 400 }
      );
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const uploaderEmail = formData.get("email") as string | null;

    if (!file) {
      return NextResponse.json(
        { error: "נדרש קובץ", code: "FILE_REQUIRED" },
        { status: 400 }
      );
    }

    // Validate file type (client-provided MIME type)
    const allowedTypes = link.allowedFileTypes
      ? link.allowedFileTypes.split(",").map((t) => t.trim())
      : getAllowedMimeTypes();

    if (!allowedTypes.includes(file.type) && !isAllowedFileType(file.type)) {
      return NextResponse.json(
        {
          error: "סוג קובץ לא מורשה",
          code: "INVALID_FILE_TYPE",
          allowedTypes,
        },
        { status: 400 }
      );
    }

    // Early size check BEFORE loading file into memory to prevent memory exhaustion attacks
    const maxSize = link.maxFileSize || getMaxFileSize();
    if (file.size > maxSize) {
      return NextResponse.json(
        {
          error: `גודל הקובץ חורג מהמקסימום המותר (${Math.round(maxSize / 1024 / 1024)}MB)`,
          code: "FILE_TOO_LARGE",
        },
        { status: 400 }
      );
    }

    // Convert to buffer for magic byte validation
    const buffer = Buffer.from(await file.arrayBuffer());

    // Validate file content matches claimed type (magic byte detection)
    // This prevents MIME type spoofing attacks
    const fileValidation = await validateFileType(buffer, file.type);
    if (!fileValidation.valid) {
      console.warn("File upload rejected - type mismatch:", {
        claimed: file.type,
        detected: fileValidation.detectedMimeType,
        error: fileValidation.error,
        uploadLinkId: link.id,
        uploaderEmail,
      });
      return NextResponse.json(
        {
          error: "תוכן הקובץ אינו תואם לסוג המוצהר",
          code: "FILE_TYPE_MISMATCH",
        },
        { status: 400 }
      );
    }

    // Secondary size validation using actual buffer length (defense in depth)
    // This catches cases where file.size was spoofed or inaccurate
    if (buffer.length > maxSize) {
      return NextResponse.json(
        {
          error: `גודל הקובץ חורג מהמקסימום המותר (${Math.round(maxSize / 1024 / 1024)}MB)`,
          code: "FILE_TOO_LARGE",
        },
        { status: 400 }
      );
    }

    // Check if this is a BKMVDATA file and generate custom file name
    let customFileName: string | undefined;
    if (link.entityType === "franchisee" && isBkmvDataFile(buffer)) {
      // Try to extract date range early for file naming
      try {
        const earlyParse = parseBkmvData(buffer);
        const earlyDateRange = extractDateRange(earlyParse);
        if (earlyDateRange && link.entityName) {
          const periodStartDate = formatDateAsLocal(earlyDateRange.startDate);
          customFileName = generateEntityFileName(
            link.entityName,
            periodStartDate,
            file.name
          );
        }
      } catch {
        // If parsing fails, we'll use the default file name
        // The full BKMVDATA processing will handle the error later
      }
    }

    // Upload the file to storage using validated buffer
    const uploadResult = await uploadDocument(
      buffer,
      file.name,
      fileValidation.detectedMimeType || file.type,
      link.entityType,
      link.entityId,
      customFileName ? { customFileName } : undefined
    );

    // Get client IP
    const forwardedFor = request.headers.get("x-forwarded-for");
    const clientIp = forwardedFor
      ? forwardedFor.split(",")[0].trim()
      : request.headers.get("x-real-ip") || "unknown";

    // Create uploaded file record
    const uploadedFileRecord = await createUploadedFile({
      id: randomUUID(),
      uploadLinkId: link.id,
      fileName: uploadResult.fileName,
      originalFileName: uploadResult.originalFileName,
      fileUrl: uploadResult.url,
      fileSize: uploadResult.fileSize,
      mimeType: uploadResult.mimeType,
      uploadedByEmail: uploaderEmail || null,
      uploadedByIp: clientIp,
      metadata: {
        storageType: uploadResult.storageType,
      },
    });

    // Check if we've reached max files and should mark as used
    const newFilesCount = currentFilesCount + 1;
    if (newFilesCount >= link.maxFiles) {
      await markUploadLinkAsUsed(link.id, uploaderEmail || undefined);
    }

    // Automatic BKMVDATA processing for franchisee uploads
    let bkmvProcessingResult = null;
    let shouldNotify = true; // Default: notify for all non-BKMVDATA uploads
    if (link.entityType === "franchisee" && isBkmvDataFile(buffer)) {
      try {
        console.log("Detected BKMVDATA file upload from franchisee:", link.entityId);

        // Mark file as processing
        await updateUploadedFileProcessingStatus(uploadedFileRecord.id, "processing");

        // Parse the BKMVDATA file
        const parseResult = parseBkmvData(buffer);

        // Extract date range from transactions
        const dateRange = extractDateRange(parseResult);

        if (dateRange) {
          // Format dates as YYYY-MM-DD
          const periodStartDate = formatDateAsLocal(dateRange.startDate);
          const periodEndDate = formatDateAsLocal(dateRange.endDate);

          // Get all suppliers and blacklist for matching
          const allSuppliers = await getSuppliers();
          const blacklistedNames = await getBlacklistedNamesSet();

          // Match suppliers from BKMVDATA with blacklist support
          const matchResults = matchBkmvSuppliers(
            parseResult.supplierSummary,
            allSuppliers,
            { minConfidence: 0.6, reviewThreshold: 1.0 },
            blacklistedNames
          );

          // Calculate match statistics (excluding blacklisted items)
          const nonBlacklistedResults = matchResults.filter(r => r.matchResult.matchType !== "blacklisted");
          const exactMatches = nonBlacklistedResults.filter(r =>
            r.matchResult.matchedSupplier && r.matchResult.confidence === 1
          ).length;
          const fuzzyMatches = nonBlacklistedResults.filter(r =>
            r.matchResult.matchedSupplier && r.matchResult.confidence < 1
          ).length;
          const unmatched = nonBlacklistedResults.filter(r => !r.matchResult.matchedSupplier).length;

          // Try to match franchisee by company ID
          let matchedFranchiseeId: string | null = null;
          if (parseResult.companyId) {
            const franchisee = await getFranchiseeByCompanyId(parseResult.companyId);
            if (franchisee) {
              matchedFranchiseeId = franchisee.id;
            }
          }

          // Determine processing status
          // Auto-approve if all non-blacklisted matches are exact (100% confidence) and no unmatched
          const shouldAutoApprove = exactMatches === nonBlacklistedResults.length && unmatched === 0;
          const processingStatus = shouldAutoApprove ? "auto_approved" : "needs_review";

          // Prepare processing result for storage
          const storedResult: BkmvProcessingResult = {
            companyId: parseResult.companyId,
            fileVersion: parseResult.fileVersion,
            totalRecords: parseResult.totalRecords,
            dateRange: {
              startDate: periodStartDate,
              endDate: periodEndDate,
            },
            matchStats: {
              total: matchResults.length,
              exactMatches,
              fuzzyMatches,
              unmatched,
            },
            matchedFranchiseeId,
            supplierMatches: matchResults.map(r => ({
              bkmvName: r.bkmvName,
              amount: r.amount,
              transactionCount: r.transactionCount,
              matchedSupplierId: r.matchResult.matchedSupplier?.id || null,
              matchedSupplierName: r.matchResult.matchedSupplier?.name || null,
              confidence: r.matchResult.confidence,
              matchType: r.matchResult.matchType,
              requiresReview: r.matchResult.requiresReview,
            })),
            processedAt: new Date().toISOString(),
          };

          // Update file with processing status and result
          await updateUploadedFileProcessingStatus(
            uploadedFileRecord.id,
            processingStatus,
            storedResult
          );

          // Process the BKMVDATA and update cross-references
          const processingResult = await processFranchiseeBkmvData(
            link.entityId,
            parseResult,
            periodStartDate,
            periodEndDate,
            undefined // No user ID for public uploads
          );

          bkmvProcessingResult = {
            processed: true,
            companyId: parseResult.companyId,
            periodStartDate,
            periodEndDate,
            totalSuppliers: parseResult.supplierSummary.size,
            matched: processingResult.suppliersMatched,
            unmatched: processingResult.suppliersUnmatched,
            crossReferencesUpdated: processingResult.crossReferencesUpdated,
            crossReferencesCreated: processingResult.crossReferencesCreated,
            errors: processingResult.errors,
            processingStatus,
            autoApproved: shouldAutoApprove,
          };

          // Only notify if file needs manual review
          shouldNotify = processingStatus === "needs_review";

          console.log("BKMVDATA processing completed:", bkmvProcessingResult);
        } else {
          console.warn("Could not extract date range from BKMVDATA file");
          await updateUploadedFileProcessingStatus(uploadedFileRecord.id, "needs_review");
          bkmvProcessingResult = {
            processed: false,
            error: "Could not extract date range from file",
          };
        }
      } catch (bkmvError) {
        console.error("Error processing BKMVDATA file:", bkmvError);
        await updateUploadedFileProcessingStatus(uploadedFileRecord.id, "needs_review");
        bkmvProcessingResult = {
          processed: false,
          error: bkmvError instanceof Error ? bkmvError.message : "Unknown error",
        };
        // Still notify on error since file needs manual review
        shouldNotify = true;
      }
    }

    // Automatic supplier file processing for supplier uploads
    let supplierProcessingResult = null;
    const isExcelFile = file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
                        file.type === "application/vnd.ms-excel";

    if (link.entityType === "supplier" && isExcelFile) {
      // Get supplier details outside try-catch so we have access in catch block
      const supplier = await getSupplierById(link.entityId);

      try {
        console.log("Detected Excel file upload from supplier:", link.entityId);
        if (!supplier) {
          console.error("Supplier not found:", link.entityId);
          supplierProcessingResult = {
            processed: false,
            error: "Supplier not found",
          };
        } else if (!supplier.fileMapping && !(supplier.code && requiresCustomParser(supplier.code))) {
          // Supplier has neither fileMapping nor custom parser - cannot process automatically
          console.warn("Supplier has no file mapping or custom parser configured:", supplier.name);

          // Create a supplier_file_upload record so it appears in the supplier files review queue
          // (not in the BKMVDATA review queue)
          const supplierFileRecord = await createSupplierFileUpload({
            supplierId: supplier.id,
            originalFileName: file.name,
            fileUrl: uploadResult.url,
            fileSize: uploadResult.fileSize,
            processingStatus: "needs_review",
            processingResult: null,
            periodStartDate: null,
            periodEndDate: null,
            createdBy: null,
          });

          // Update uploaded_file status (without bkmvProcessingResult, so it won't appear in BKMVDATA review)
          await updateUploadedFileProcessingStatus(uploadedFileRecord.id, "needs_review");

          supplierProcessingResult = {
            processed: false,
            error: "Supplier file mapping not configured - requires manual processing",
            supplierName: supplier.name,
            supplierFileId: supplierFileRecord.id,
          };
        } else {
          // Mark file as processing
          await updateUploadedFileProcessingStatus(uploadedFileRecord.id, "processing");

          // Get VAT rate
          const vatRate = await getCurrentVatRate();

          // Process the supplier file
          const fileMapping = supplier.fileMapping as SupplierFileMapping;
          const processResult = await processSupplierFile(
            buffer,
            fileMapping,
            supplier.vatIncluded ?? false,
            vatRate,
            supplier.code ?? undefined
          );

          if (!processResult.success || processResult.data.length === 0) {
            console.error("Failed to process supplier file:", processResult.errors);

            // Create supplier_file_upload record even on failure so it appears in the correct review queue
            const supplierFileRecord = await createSupplierFileUpload({
              supplierId: supplier.id,
              originalFileName: file.name,
              fileUrl: uploadResult.url,
              fileSize: uploadResult.fileSize,
              processingStatus: "needs_review",
              processingResult: null,
              periodStartDate: null,
              periodEndDate: null,
              createdBy: null,
            });

            await updateUploadedFileProcessingStatus(uploadedFileRecord.id, "needs_review");
            supplierProcessingResult = {
              processed: false,
              error: processResult.errors?.[0]?.message || "Failed to process file",
              supplierName: supplier.name,
              supplierFileId: supplierFileRecord.id,
            };
          } else {
            // Match franchisee names
            const matchedResults = await matchFranchiseeNamesFromFile(processResult.data);

            // Calculate match statistics
            const exactMatches = matchedResults.filter(
              r => r.matchResult.matchedFranchisee && r.matchResult.confidence === 1
            ).length;
            const fuzzyMatches = matchedResults.filter(
              r => r.matchResult.matchedFranchisee && r.matchResult.confidence < 1 && !r.matchResult.requiresReview
            ).length;
            const needsReview = matchedResults.filter(
              r => r.matchResult.matchedFranchisee && r.matchResult.requiresReview
            ).length;
            const unmatched = matchedResults.filter(
              r => !r.matchResult.matchedFranchisee
            ).length;

            // Extract period dates from processed data
            const datesInFile = processResult.data
              .map(row => row.date)
              .filter((d): d is Date => d !== null);

            let periodStartDate = formatDateAsLocal(new Date());
            let periodEndDate = formatDateAsLocal(new Date());

            if (datesInFile.length > 0) {
              const earliest = datesInFile.reduce((min, d) => d < min ? d : min, datesInFile[0]);
              const latest = datesInFile.reduce((max, d) => d > max ? d : max, datesInFile[0]);
              periodStartDate = formatDateAsLocal(earliest);
              periodEndDate = formatDateAsLocal(latest);
            }

            // Determine processing status
            const shouldAutoApprove = unmatched === 0 && needsReview === 0;
            const processingStatus = shouldAutoApprove ? "auto_approved" : "needs_review";

            // Determine match type for each result
            const getMatchType = (r: typeof matchedResults[0]): "exact" | "fuzzy" | "manual" | "blacklisted" | "none" => {
              if (!r.matchResult.matchedFranchisee) return "none";
              if (r.matchResult.confidence === 1) return "exact";
              return "fuzzy";
            };

            // Prepare processing result for storage
            const storedResult: SupplierFileProcessingResult = {
              totalRows: processResult.summary.totalRows,
              processedRows: processResult.summary.processedRows,
              skippedRows: processResult.summary.skippedRows,
              totalGrossAmount: processResult.summary.totalGrossAmount,
              totalNetAmount: processResult.summary.totalNetAmount,
              vatAdjusted: supplier.vatIncluded ?? false,
              matchStats: {
                total: matchedResults.length,
                exactMatches,
                fuzzyMatches,
                unmatched,
              },
              franchiseeMatches: matchedResults.map(r => ({
                originalName: r.franchisee,
                rowNumber: r.rowNumber,
                grossAmount: r.grossAmount,
                netAmount: r.netAmount,
                matchedFranchiseeId: r.matchResult.matchedFranchisee?.id || null,
                matchedFranchiseeName: r.matchResult.matchedFranchisee?.name || null,
                confidence: r.matchResult.confidence,
                matchType: getMatchType(r),
                requiresReview: r.matchResult.requiresReview,
                preCalculatedCommission: r.preCalculatedCommission,
              })),
              processedAt: new Date().toISOString(),
            };

            // Create supplier_file_upload record
            const supplierFileRecord = await createSupplierFileUpload({
              supplierId: supplier.id,
              originalFileName: file.name,
              fileUrl: uploadResult.url,
              fileSize: uploadResult.fileSize,
              processingStatus,
              processingResult: storedResult,
              periodStartDate,
              periodEndDate,
              createdBy: null, // Public upload, no user
            });

            // Update uploaded_file status
            await updateUploadedFileProcessingStatus(
              uploadedFileRecord.id,
              processingStatus
            );

            supplierProcessingResult = {
              processed: true,
              supplierName: supplier.name,
              supplierFileId: supplierFileRecord.id,
              periodStartDate,
              periodEndDate,
              totalRows: processResult.summary.processedRows,
              matchStats: {
                total: matchedResults.length,
                exactMatches,
                fuzzyMatches,
                needsReview,
                unmatched,
              },
              processingStatus,
              autoApproved: shouldAutoApprove,
            };

            // Only notify if file needs manual review
            shouldNotify = processingStatus === "needs_review";

            console.log("Supplier file processing completed:", supplierProcessingResult);
          }
        }
      } catch (supplierError) {
        console.error("Error processing supplier file:", supplierError);

        // Create supplier_file_upload record on error so it appears in the correct review queue
        if (supplier) {
          const supplierFileRecord = await createSupplierFileUpload({
            supplierId: supplier.id,
            originalFileName: file.name,
            fileUrl: uploadResult.url,
            fileSize: uploadResult.fileSize,
            processingStatus: "needs_review",
            processingResult: null,
            periodStartDate: null,
            periodEndDate: null,
            createdBy: null,
          });

          supplierProcessingResult = {
            processed: false,
            error: supplierError instanceof Error ? supplierError.message : "Unknown error",
            supplierFileId: supplierFileRecord.id,
          };
        } else {
          supplierProcessingResult = {
            processed: false,
            error: supplierError instanceof Error ? supplierError.message : "Unknown error",
          };
        }

        await updateUploadedFileProcessingStatus(uploadedFileRecord.id, "needs_review");
        // Still notify on error since file needs manual review
        shouldNotify = true;
      }
    }

    // Notify super users about the upload (non-blocking)
    // Only notify if the file needs review (auto-approved files skip notification)
    if (shouldNotify) {
      notifySuperUsersAboutUpload(link.id, uploadedFileRecord).catch((error) => {
        console.error("Failed to notify super users about upload:", error);
      });
    }

    return NextResponse.json(
      {
        success: true,
        message: "הקובץ הועלה בהצלחה",
        file: {
          id: uploadedFileRecord.id,
          fileName: uploadedFileRecord.originalFileName,
          fileSize: uploadedFileRecord.fileSize,
          mimeType: uploadedFileRecord.mimeType,
        },
        filesRemaining: link.maxFiles - newFilesCount,
        bkmvProcessing: bkmvProcessingResult,
        supplierProcessing: supplierProcessingResult,
      },
      { status: 201 }
    );
  } catch (error) {
    console.error("Error uploading file:", error);
    return NextResponse.json(
      { error: "שגיאה בהעלאת הקובץ", code: "UPLOAD_ERROR" },
      { status: 500 }
    );
  }
}
