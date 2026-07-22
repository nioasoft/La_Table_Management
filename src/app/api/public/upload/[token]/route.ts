import { NextRequest, NextResponse } from "next/server";
import {
  getUploadLinkByToken,
  isUploadLinkValid,
  createUploadedFile,
  getUploadedFilesCount,
  markUploadLinkAsUsed,
  markUploadLinkAsActive,
  updateUploadedFileProcessingStatus,
  deleteUploadedFile,
} from "@/data-access/uploadLinks";
import { getSuppliers, getSupplierById } from "@/data-access/suppliers";
import { markFileRequestAsSubmitted, getFileRequestByUploadLinkId } from "@/data-access/fileRequests";
import { matchBkmvSuppliers } from "@/lib/supplier-matcher";
import {
  getFranchiseeByCompanyId,
  matchFranchiseeNamesFromFileWithAnomalies,
} from "@/data-access/franchisees";
import { getFranchiseeRevenueCodesList } from "@/data-access/franchisee-revenue-codes";
import type { BkmvProcessingResult, SupplierFileMapping, SupplierFileProcessingResult } from "@/db/schema";
import {
  uploadDocument,
  deleteDocumentFile,
  generateEntityFileName,
  isAllowedFileType,
  isFileSizeValid,
  getMaxFileSize,
  getAllowedMimeTypes,
} from "@/lib/storage";
import { validateFileType } from "@/lib/file-validation";
import { randomUUID } from "crypto";
import { notifySuperUsersAboutUpload } from "@/lib/notifications";
import { isBkmvDataFile, parseBkmvData, extractDateRange, buildMonthlyBreakdown, convertRevenueSummaryToArray, convertAllAccountsSummaryToArray, buildAllAccountsSummary, buildRevenueMonthlyBreakdown, mergeRevenueSummaryIntoAllAccounts } from "@/lib/bkmvdata-parser";
import { processFranchiseeBkmvData } from "@/data-access/crossReferences";
import { getBlacklistedNamesSet } from "@/data-access/bkmvBlacklist";
import { getSmallSupplierNamesSet } from "@/data-access/bkmvSmallSuppliers";
import { formatDateAsLocal } from "@/lib/date-utils";
import { processSupplierFile, getCurrentVatRate } from "@/lib/file-processor";
import { requiresCustomParser } from "@/lib/custom-parsers";
import { getPeriodsForFrequency, getPeriodByKey } from "@/lib/settlement-periods";
import type { SettlementPeriodType } from "@/db/schema";
import { createSupplierFileUpload, findDuplicateSupplierFiles, reviewSupplierFile } from "@/data-access/supplier-file-uploads";
import {
  logSupplierFileProcessingDiagnostic,
  sha256Hex,
} from "@/data-access/supplier-file-processing-diagnostics";
import { deleteCommissionsBySourceFile } from "@/data-access/commissions";
import { getVatProductNames, syncSupplierProducts } from "@/data-access/supplier-products";
import { filterFileLevelAnomalies } from "@/types/file-anomalies";

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
 * Build a SupplierFileProcessingResult that records a parser failure.
 * Used so failed uploads land in the review queue with a visible error
 * instead of a NULL processing_result that the UI can't act on.
 */
function buildErrorProcessingResult(error: string): SupplierFileProcessingResult {
  return {
    totalRows: 0,
    processedRows: 0,
    skippedRows: 0,
    totalGrossAmount: 0,
    totalNetAmount: 0,
    vatAdjusted: false,
    matchStats: { total: 0, exactMatches: 0, fuzzyMatches: 0, unmatched: 0 },
    franchiseeMatches: [],
    processedAt: new Date().toISOString(),
    error,
  };
}

/**
 * Reject an upload with a user-readable Hebrew message AND a structured
 * server log. Every rejection goes through here so a supplier who says
 * "it didn't upload" can read back the code, and we can grep the logs by
 * code/link without digging — no rejection is silent.
 */
function rejectUpload(
  code: string,
  status: number,
  messageHe: string,
  ctx: Record<string, unknown> = {}
): NextResponse {
  console.warn("[upload] rejected", { code, status, ...ctx });
  return NextResponse.json({ error: messageHe, code }, { status });
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
      return rejectUpload(
        "MAX_FILES_REACHED",
        400,
        `כבר הועלו כל הקבצים המותרים בקישור זה (${link.maxFiles}). אם צריך להחליף קובץ — פני אלינו.`,
        { linkId: link.id, entityType: link.entityType, entityId: link.entityId }
      );
    }

    // Parse form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const uploaderEmail = formData.get("email") as string | null;
    const replaceFileId = formData.get("replaceFileId") as string | null;

    if (!file) {
      return rejectUpload(
        "FILE_REQUIRED",
        400,
        "לא נבחר קובץ. בחרי קובץ ולחצי על 'העלה'.",
        { linkId: link.id, email: uploaderEmail }
      );
    }

    // Validate file type (client-provided MIME type).
    //
    // Chrome on Windows often reports text files (BKMVDATA.txt, .csv) as
    // `application/octet-stream` or with an empty MIME type. When that
    // happens, fall back to inferring the type from the extension so the
    // upload isn't rejected for a legitimate file. The downstream
    // `validateFileType` call still verifies the actual content with
    // magic-byte / text-validation, so spoofing is not a concern.
    const allowedTypes = link.allowedFileTypes
      ? link.allowedFileTypes.split(",").map((t) => t.trim())
      : getAllowedMimeTypes();

    const inferMimeFromName = (name: string): string | null => {
      const ext = name.toLowerCase().split(".").pop();
      const map: Record<string, string> = {
        txt: "text/plain",
        csv: "text/csv",
        pdf: "application/pdf",
        xls: "application/vnd.ms-excel",
        xlsx: "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        doc: "application/msword",
        docx: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        jpg: "image/jpeg",
        jpeg: "image/jpeg",
        png: "image/png",
        gif: "image/gif",
      };
      return ext ? map[ext] ?? null : null;
    };

    let effectiveMimeType = file.type;
    if (!effectiveMimeType || effectiveMimeType === "application/octet-stream") {
      const inferred = inferMimeFromName(file.name);
      if (inferred) effectiveMimeType = inferred;
    }

    if (
      !allowedTypes.includes(effectiveMimeType) &&
      !allowedTypes.includes(file.type) &&
      !isAllowedFileType(effectiveMimeType)
    ) {
      return rejectUpload(
        "INVALID_FILE_TYPE",
        400,
        "סוג הקובץ אינו נתמך. יש להעלות קובץ Excel (‎.xlsx או ‎.xls) או CSV.",
        { linkId: link.id, fileName: file.name, claimed: file.type, inferred: effectiveMimeType }
      );
    }

    // Early size check BEFORE loading file into memory to prevent memory exhaustion attacks
    const maxSize = link.maxFileSize || getMaxFileSize();
    if (file.size > maxSize) {
      return rejectUpload(
        "FILE_TOO_LARGE",
        400,
        `הקובץ גדול מדי (מקסימום ${Math.round(maxSize / 1024 / 1024)}MB). נסי לשמור אותו מחדש או לפצל אותו.`,
        { linkId: link.id, fileName: file.name, fileSize: file.size }
      );
    }

    // Convert to buffer for magic byte validation
    const buffer = Buffer.from(await file.arrayBuffer());

    // Validate file content matches claimed type (magic byte detection).
    // This prevents MIME type spoofing attacks. Use the extension-inferred
    // type when the browser sent application/octet-stream or a blank MIME,
    // so a legitimate BKMVDATA.txt is treated as text/plain by the
    // validator instead of forced down the binary magic-byte path.
    const fileValidation = await validateFileType(buffer, effectiveMimeType);
    if (!fileValidation.valid) {
      return rejectUpload(
        "FILE_TYPE_MISMATCH",
        400,
        "הקובץ אינו קובץ Excel תקין או שהוא פגום. פתחי אותו ב-Excel, שמרי שוב כקובץ ‎.xlsx ונסי להעלות מחדש.",
        {
          linkId: link.id,
          fileName: file.name,
          email: uploaderEmail,
          claimed: file.type,
          detected: fileValidation.detectedMimeType,
          detail: fileValidation.error,
        }
      );
    }

    // Secondary size validation using actual buffer length (defense in depth)
    // This catches cases where file.size was spoofed or inaccurate
    if (buffer.length > maxSize) {
      return rejectUpload(
        "FILE_TOO_LARGE",
        400,
        `הקובץ גדול מדי (מקסימום ${Math.round(maxSize / 1024 / 1024)}MB). נסי לשמור אותו מחדש או לפצל אותו.`,
        { linkId: link.id, fileName: file.name, bufferLength: buffer.length }
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
      fileValidation.detectedMimeType || effectiveMimeType || file.type,
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
      // Mark the underlying file_request as submitted so reminder crons stop
      // pinging accountants/owners after the file has been received.
      await markFileRequestAsSubmitted(link.id);
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

          // Get all suppliers, blacklist, and small suppliers for matching
          const allSuppliers = await getSuppliers();
          const blacklistedNames = await getBlacklistedNamesSet();
          const smallSupplierNames = await getSmallSupplierNamesSet();

          // Match suppliers from BKMVDATA with blacklist + small supplier support
          const matchResults = matchBkmvSuppliers(
            parseResult.supplierSummary,
            allSuppliers,
            { minConfidence: 0.6, reviewThreshold: 1.0 },
            blacklistedNames,
            smallSupplierNames
          );

          // Calculate match statistics (excluding blacklisted and small supplier items)
          const classifiedResults = matchResults.filter(r =>
            r.matchResult.matchType !== "blacklisted" && r.matchResult.matchType !== "small_supplier"
          );
          const exactMatches = classifiedResults.filter(r =>
            r.matchResult.matchedSupplier && r.matchResult.confidence === 1
          ).length;
          const fuzzyMatches = classifiedResults.filter(r =>
            r.matchResult.matchedSupplier && r.matchResult.confidence < 1
          ).length;
          const unmatched = classifiedResults.filter(r => !r.matchResult.matchedSupplier).length;

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
          const shouldAutoApprove = exactMatches === classifiedResults.length && unmatched === 0;
          const processingStatus = shouldAutoApprove ? "auto_approved" : "needs_review";

          // Build supplier ID map for monthly breakdown (maps BKMV name to matched supplier ID)
          // Only include exact matches (confidence === 1) — fuzzy matches should not be stored
          const supplierIdMap = new Map<string, string | null>();
          for (const r of matchResults) {
            const isExact = r.matchResult.matchedSupplier && r.matchResult.confidence === 1;
            supplierIdMap.set(r.bkmvName, isExact ? r.matchResult.matchedSupplier!.id : null);
          }

          // Build monthly breakdown for precise period matching
          const monthlyBreakdown = buildMonthlyBreakdown(parseResult.transactions, supplierIdMap);

          // Extract revenue accounts from the parsed data
          const revenueAccounts = convertRevenueSummaryToArray(parseResult.revenueSummary);

          // Build all-accounts summary for manual revenue classification
          const allAccountsMap = buildAllAccountsSummary(parseResult);
          mergeRevenueSummaryIntoAllAccounts(allAccountsMap, parseResult.revenueSummary);
          const revenueCodeSet = new Set(revenueAccounts.map(a => a.accountCode));
          const allAccountSummaries = convertAllAccountsSummaryToArray(allAccountsMap).map(a => ({
            ...a,
            autoDetectedAsRevenue: revenueCodeSet.has(a.accountCode),
          }));

          // Check if franchisee has saved revenue account codes for auto-matching
          const savedRevenueCodes = await getFranchiseeRevenueCodesList(link.entityId);
          const confirmedRevenueAccountCodes: string[] = [];

          // Mark all saved codes that match found accounts as confirmed
          for (const savedCode of savedRevenueCodes) {
            const matchingAccount = revenueAccounts.find(a => a.accountCode === savedCode);
            if (matchingAccount) {
              matchingAccount.isConfirmed = true;
              confirmedRevenueAccountCodes.push(savedCode);
            }
          }

          // Build revenue monthly breakdown (using all confirmed accounts)
          const revenueMonthlyBreakdown = buildRevenueMonthlyBreakdown(
            parseResult.revenueSummary,
            confirmedRevenueAccountCodes.length > 0 ? confirmedRevenueAccountCodes : null
          );

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
            monthlyBreakdown,
            revenueAccounts: revenueAccounts.length > 0 ? revenueAccounts : undefined,
            allAccountSummaries: allAccountSummaries.length > 0 ? allAccountSummaries : undefined,
            revenueMonthlyBreakdown: Object.keys(revenueMonthlyBreakdown).length > 0 ? revenueMonthlyBreakdown : undefined,
            confirmedRevenueAccountCodes: confirmedRevenueAccountCodes.length > 0 ? confirmedRevenueAccountCodes : undefined,
            confirmedRevenueAccountCode: confirmedRevenueAccountCodes.length > 0 ? confirmedRevenueAccountCodes[0] : null,
            processedAt: new Date().toISOString(),
          };

          // Update file with processing status and result
          await updateUploadedFileProcessingStatus(
            uploadedFileRecord.id,
            processingStatus,
            storedResult
          );

          // Archive to year-based BKMV table
          try {
            const { upsertFromFullBreakdown } = await import("@/data-access/franchisee-bkmv-year");
            await upsertFromFullBreakdown(
              link.entityId,
              monthlyBreakdown,
              storedResult.supplierMatches,
              uploadedFileRecord.id
            );
          } catch (yearError) {
            console.error("Error archiving BKMV year data:", yearError);
          }

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
    // CSV included: some suppliers (e.g. עלה עלה) send CSV reports and their
    // parsers handle it. Without this, CSV uploads sat as "pending" forever
    // with no supplier_file_upload record — invisible to the review queue.
    const isProcessableFile =
      file.type === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
      file.type === "application/vnd.ms-excel" ||
      file.type === "text/csv" ||
      file.name.toLowerCase().endsWith(".csv");

    if (link.entityType === "supplier" && isProcessableFile) {
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
            processingResult: buildErrorProcessingResult(
              "לא הוגדרה מיפוי לקובץ עבור ספק זה. יש להגדיר מיפוי או פרסר ידני בעמוד עריכת הספק."
            ),
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

          // Load per-item VAT products for vatExempt suppliers
          const vatProductNames = supplier.vatExempt
            ? await getVatProductNames(supplier.id)
            : undefined;

          // Process the supplier file
          const fileMapping = supplier.fileMapping as SupplierFileMapping;
          const processResult = await processSupplierFile(
            buffer,
            fileMapping,
            supplier.vatIncluded ?? false,
            vatRate,
            supplier.code ?? undefined,
            supplier.vatExempt ?? false,
            vatProductNames,
            file.name
          );

          // Sync extracted products to supplier_product table
          if (processResult.summary.extractedProducts?.length) {
            await syncSupplierProducts(
              supplier.id,
              processResult.summary.extractedProducts
            );
          }

          if (!processResult.success || processResult.data.length === 0) {
            console.error("Failed to process supplier file:", processResult.errors);

            const parserErrorMessage =
              processResult.errors?.[0]?.message ||
              (processResult.data.length === 0
                ? "לא נמצאו נתונים לעיבוד בקובץ"
                : "כשל בעיבוד קובץ הספק");

            // Create supplier_file_upload record even on failure so it appears in the correct review queue
            const supplierFileRecord = await createSupplierFileUpload({
              supplierId: supplier.id,
              originalFileName: file.name,
              fileUrl: uploadResult.url,
              fileSize: uploadResult.fileSize,
              processingStatus: "needs_review",
              processingResult: buildErrorProcessingResult(parserErrorMessage),
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
            // Match franchisee names + derive review-modal anomalies
            const matchOutcome = await matchFranchiseeNamesFromFileWithAnomalies(
              processResult.data
            );
            const matchedResults = matchOutcome.rows;
            const matchAnomalies = matchOutcome.anomalies;

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

            let periodStartDate: string | null = null;
            let periodEndDate: string | null = null;

            if (datesInFile.length > 0) {
              const earliest = datesInFile.reduce((min, d) => d < min ? d : min, datesInFile[0]);
              const latest = datesInFile.reduce((max, d) => d > max ? d : max, datesInFile[0]);
              periodStartDate = formatDateAsLocal(earliest);
              periodEndDate = formatDateAsLocal(latest);
            } else {
              // No dates in file (e.g. Nespresso, Fresco, Erel). Prefer the
              // period that was actually REQUESTED via this link's
              // file_request (metadata.periodKey, e.g. "2026-Q2") so the
              // stamp doesn't drift with the upload date. Without this, a
              // file uploaded inside the reporting quarter resolves to the
              // *previous* quarter (includeCurrent=false) and gets rejected
              // as a duplicate of the prior period's report.
              const fileReq = await getFileRequestByUploadLinkId(link.id);
              const requestedKey = (fileReq?.metadata as Record<string, unknown> | null)?.periodKey;
              const requestedPeriod =
                typeof requestedKey === "string" ? getPeriodByKey(requestedKey) : null;

              if (requestedPeriod) {
                periodStartDate = formatDateAsLocal(requestedPeriod.startDate);
                periodEndDate = formatDateAsLocal(requestedPeriod.endDate);
              } else {
                // Fallback: derive from supplier's settlement frequency + upload date.
                const frequency = (supplier.settlementFrequency as SettlementPeriodType) || "quarterly";
                const fiscalYearStartMonth = supplier.fiscalYearStartMonth ?? 1;
                const periods = getPeriodsForFrequency(frequency, new Date(), 1, fiscalYearStartMonth);
                if (periods.length > 0) {
                  periodStartDate = formatDateAsLocal(periods[0].startDate);
                  periodEndDate = formatDateAsLocal(periods[0].endDate);
                }
              }
            }

            // Determine processing status
            const shouldAutoApprove = unmatched === 0 && needsReview === 0;
            const processingStatus = shouldAutoApprove ? "auto_approved" : "needs_review";

            // Determine match type for each result
            const getMatchType = (r: typeof matchedResults[0]): "exact" | "exact_code" | "fuzzy" | "manual" | "blacklisted" | "none" => {
              if (!r.matchResult.matchedFranchisee) return "none";
              // Check if this was matched by companyId/taxId (exact_code)
              if (r.matchResult.matchType === "exact_code") return "exact_code";
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
              // Persist anomalies for the admin pre-save modal. Match-level
              // anomalies are filtered out — they're already shown per-row in
              // the review screen and produced false-alarm warnings that
              // didn't refresh after a manual match.
              anomalies: filterFileLevelAnomalies([
                ...(processResult.anomalies ?? []),
                ...matchAnomalies,
              ]),
            };

            // Check for duplicate files (same supplier + period + franchisee)
            const matchedFranchiseeIds = storedResult.franchiseeMatches
              .filter(m => {
                if (!m.matchedFranchiseeId) return false;
                if (typeof m.matchedFranchiseeId === 'string' && m.matchedFranchiseeId.trim() === '') {
                  console.warn(`[Upload Route] Filtering out empty string matchedFranchiseeId for originalName: ${m.originalName}`);
                  return false;
                }
                return true;
              })
              .map(m => m.matchedFranchiseeId!);

            console.log("[Upload Route] Checking for duplicates:", {
              supplierId: supplier.id,
              periodStartDate,
              periodEndDate,
              matchedFranchiseeIds,
              franchiseeMatches: storedResult.franchiseeMatches.map(m => ({
                originalName: m.originalName,
                matchedFranchiseeId: m.matchedFranchiseeId,
                matchedFranchiseeName: m.matchedFranchiseeName,
                matchType: m.matchType,
              })),
              replaceFileId,
            });

            if (periodStartDate && periodEndDate && matchedFranchiseeIds.length > 0) {
              const duplicates = await findDuplicateSupplierFiles(
                supplier.id,
                periodStartDate,
                periodEndDate,
                matchedFranchiseeIds
              );

              console.log("[Upload Route] Duplicate check result:", {
                duplicatesFound: duplicates.length,
                duplicates: duplicates.map(d => ({
                  fileId: d.fileId,
                  fileName: d.originalFileName,
                  overlappingFranchiseeIds: d.overlappingFranchiseeIds,
                })),
              });

              if (duplicates.length > 0 && !replaceFileId) {
                // Duplicate found and user hasn't confirmed replacement - return 409
                console.log("[Upload Route] Returning 409 DUPLICATE_FILE error");

                // Get the overlapping franchisee names for better error message
                const overlappingMatches = storedResult.franchiseeMatches
                  .filter(m => m.matchedFranchiseeId && duplicates[0].overlappingFranchiseeIds.includes(m.matchedFranchiseeId));

                const franchiseeNames = overlappingMatches
                  .map(m => m.matchedFranchiseeName || m.originalName)
                  .filter(Boolean);

                // Clean up: delete the uploaded file from storage to avoid orphans
                console.log("[Upload Route] Cleaning up uploaded file due to duplicate detection:", uploadedFileRecord.id);
                try {
                  await deleteDocumentFile(uploadResult.url);
                  await deleteUploadedFile(uploadedFileRecord.id);
                  console.log("[Upload Route] Successfully cleaned up uploaded file");
                } catch (cleanupError) {
                  console.error("[Upload Route] Failed to clean up uploaded file:", cleanupError);
                  // Continue with the error response even if cleanup fails
                }

                // Re-open the link: it may have been marked "used" above (when
                // maxFiles was reached) before this duplicate check ran. Since
                // we just deleted the file, the supplier has NOT successfully
                // submitted and must be able to retry on the same link.
                if (newFilesCount >= link.maxFiles) {
                  await markUploadLinkAsActive(link.id);
                }

                const periodLabel = periodStartDate && periodEndDate
                  ? ` (${periodStartDate} עד ${periodEndDate})`
                  : "";
                console.warn("[upload] rejected", {
                  code: "DUPLICATE_FILE",
                  status: 409,
                  linkId: link.id,
                  fileName: file.name,
                  periodStartDate,
                  periodEndDate,
                  existingFile: duplicates[0].originalFileName,
                });

                return NextResponse.json(
                  {
                    error: franchiseeNames.length > 0
                      ? `כבר קיים במערכת דוח עבור ${franchiseeNames.join(", ")} בתקופה זו${periodLabel}. אם זה דוח מעודכן — לחצי 'החלף קובץ קיים'.`
                      : `כבר קיים במערכת דוח לתקופה זו${periodLabel}. אם זה דוח מעודכן — לחצי 'החלף קובץ קיים'.`,
                    code: "DUPLICATE_FILE",
                    duplicate: {
                      existingFileId: duplicates[0].fileId,
                      existingFileName: duplicates[0].originalFileName,
                      overlappingFranchiseeIds: duplicates[0].overlappingFranchiseeIds,
                      overlappingFranchiseeNames: franchiseeNames,
                    },
                    filesRemaining: link.maxFiles - currentFilesCount, // Return to original count since we deleted the file
                  },
                  { status: 409 }
                );
              }

              // If replaceFileId is provided, clean up old commissions and mark old record as rejected
              if (replaceFileId) {
                console.log("[Upload Route] Replacing file:", replaceFileId);
                const deletedCount = await deleteCommissionsBySourceFile(replaceFileId);
                if (deletedCount > 0) {
                  console.log(`[Upload Route] Deleted ${deletedCount} commissions from replaced file ${replaceFileId}`);
                }
                await reviewSupplierFile(
                  replaceFileId,
                  "reject",
                  "system",
                  "הוחלף בקובץ חדש"
                );
              }
            } else {
              console.log("[Upload Route] Skipping duplicate check - missing data:", {
                hasPeriodStartDate: !!periodStartDate,
                hasPeriodEndDate: !!periodEndDate,
                matchedFranchiseeIdsCount: matchedFranchiseeIds.length,
              });
            }

            // Build a descriptive file name using franchisee IDs and period
            const franchiseeIdLabel = processResult.data
              .map(row => row.franchiseeId)
              .filter(Boolean)
              .join("_") || "unknown";
            const periodLabel = periodStartDate?.substring(0, 7) ?? "no-date";
            const customSupplierFileName = generateEntityFileName(
              `${supplier.name}_${franchiseeIdLabel}_${periodLabel}`,
              periodStartDate ?? formatDateAsLocal(new Date()),
              file.name
            );

            // Create supplier_file_upload record
            const supplierFileRecord = await createSupplierFileUpload({
              supplierId: supplier.id,
              originalFileName: file.name,
              fileUrl: uploadResult.url,
              fileSize: uploadResult.fileSize,
              filePath: customSupplierFileName,
              processingStatus,
              processingResult: storedResult,
              periodStartDate,
              periodEndDate,
              createdBy: null, // Public upload, no user
            });

            // Forensic diagnostic snapshot — see explanation in /api/suppliers/.../process-file
            void logSupplierFileProcessingDiagnostic({
              supplierFileUploadId: supplierFileRecord.id,
              supplierId: supplier.id,
              fileName: file.name,
              fileSizeBytes: uploadResult.fileSize,
              fileSha256: sha256Hex(buffer),
              matchStats: storedResult.matchStats,
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

        const supplierErrorMessage =
          supplierError instanceof Error ? supplierError.message : "שגיאה לא ידועה בעיבוד הקובץ";

        // Create supplier_file_upload record on error so it appears in the correct review queue
        if (supplier) {
          const supplierFileRecord = await createSupplierFileUpload({
            supplierId: supplier.id,
            originalFileName: file.name,
            fileUrl: uploadResult.url,
            fileSize: uploadResult.fileSize,
            processingStatus: "needs_review",
            processingResult: buildErrorProcessingResult(supplierErrorMessage),
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
    // Surface a reference the supplier can read back to us; x-vercel-id maps
    // straight to the Vercel runtime logs so we can find this exact request.
    const requestId = request.headers.get("x-vercel-id") || randomUUID();
    console.error("[upload] UPLOAD_ERROR", { requestId, error });
    return NextResponse.json(
      {
        error: `שגיאה זמנית בהעלאת הקובץ. נסי שוב בעוד רגע. אם הבעיה חוזרת — צרי קשר ומסרי את הקוד: ${requestId}`,
        code: "UPLOAD_ERROR",
        requestId,
      },
      { status: 500 }
    );
  }
}
