import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError, requireRole } from "@/lib/api-middleware";
import { uploadDocument, generateEntityFileName } from "@/lib/storage";
import { parseBkmvData, extractDateRange, buildMonthlyBreakdown } from "@/lib/bkmvdata-parser";
import { matchBkmvSuppliers } from "@/lib/supplier-matcher";
import { getSuppliers } from "@/data-access/suppliers";
import { getFranchiseeByCompanyId, getFranchiseeById } from "@/data-access/franchisees";
import {
  createAdminUploadedFile,
  checkDuplicateBkmvUpload,
  updateUploadedFileProcessingStatus,
} from "@/data-access/uploadLinks";
import { markFranchiseeBkmvRequestSubmitted } from "@/data-access/fileRequests";
import { processFranchiseeBkmvData } from "@/data-access/crossReferences";
import { getBlacklistedNamesSet } from "@/data-access/bkmvBlacklist";
import { getSmallSupplierNamesSet } from "@/data-access/bkmvSmallSuppliers";
import { createAuditContext, logAuditEvent, type AuditContext } from "@/data-access/auditLog";
import { randomUUID } from "crypto";
import type { BkmvProcessingResult } from "@/db/schema";
import { formatDateAsLocal } from "@/lib/date-utils";

/**
 * Record an upload that never became an uploaded_file row.
 * Every early return below creates no file record, so without this a rejected
 * upload leaves no trace at all and "I uploaded it, nothing happened" can't be
 * answered. Never throws — logging must not break the upload response.
 */
async function logUploadFailure(
  context: AuditContext,
  fileName: string,
  reason: string,
  metadata: Record<string, unknown> = {}
): Promise<void> {
  try {
    await logAuditEvent(context, "file_process_error", "file_processing", randomUUID(), {
      entityName: fileName,
      reason,
      metadata: { route: "bkmvdata/admin-upload", ...metadata },
    });
  } catch (logError) {
    console.error("Failed to log BKMV upload failure:", logError);
  }
}

/**
 * POST /api/bkmvdata/admin-upload
 * Admin upload of BKMVDATA file with automatic processing
 */
export async function POST(request: NextRequest) {
  let auditContext: AuditContext | null = null;
  let auditFileName = "unknown";
  try {
    // Auth check
    const authResult = await requireAuth(request);
    if (isAuthError(authResult)) return authResult;

    // Role check - admin or super_user only
    const roleResult = await requireRole(request, ["admin", "super_user"]);
    if (isAuthError(roleResult)) return roleResult;

    const { user } = authResult;
    auditContext = createAuditContext({ user }, request);

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const franchiseeIdParam = formData.get("franchiseeId") as string | null;
    const periodStartDateParam = formData.get("periodStartDate") as string | null;
    const periodEndDateParam = formData.get("periodEndDate") as string | null;
    const forceReplace = formData.get("forceReplace") === "true";

    if (!file) {
      await logUploadFailure(auditContext, "(no file)", "no_file_provided", {
        franchiseeId: franchiseeIdParam,
      });
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    auditFileName = file.name;

    // Server-side file size validation (25MB limit for BKMVDATA files)
    const MAX_BKMV_FILE_SIZE = 25 * 1024 * 1024; // 25MB
    if (file.size > MAX_BKMV_FILE_SIZE) {
      await logUploadFailure(auditContext, file.name, "file_too_large", {
        fileSize: file.size,
        franchiseeId: franchiseeIdParam,
      });
      return NextResponse.json(
        { error: "הקובץ גדול מדי. הגודל המקסימלי הוא 25MB" },
        { status: 413 }
      );
    }

    // Read file buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // Parse BKMVDATA file
    let parseResult;
    try {
      parseResult = parseBkmvData(buffer);
    } catch (parseError) {
      const details = parseError instanceof Error ? parseError.message : "Unknown error";
      await logUploadFailure(auditContext, file.name, "parse_failed", {
        fileSize: file.size,
        franchiseeId: franchiseeIdParam,
        details,
      });
      return NextResponse.json(
        { error: "Failed to parse BKMVDATA file", details },
        { status: 400 }
      );
    }

    // Extract date range from file or use provided dates
    const dateRange = extractDateRange(parseResult);
    const periodStartDate = periodStartDateParam || (dateRange?.startDate ? formatDateAsLocal(dateRange.startDate) : undefined);
    const periodEndDate = periodEndDateParam || (dateRange?.endDate ? formatDateAsLocal(dateRange.endDate) : undefined);

    if (!periodStartDate || !periodEndDate) {
      await logUploadFailure(auditContext, file.name, "no_period_dates", {
        franchiseeId: franchiseeIdParam,
        companyId: parseResult.companyId,
        totalRecords: parseResult.totalRecords,
      });
      return NextResponse.json(
        { error: "Could not determine period dates. Please provide periodStartDate and periodEndDate." },
        { status: 400 }
      );
    }

    // Determine franchisee - from param or auto-detect from company ID
    let franchiseeId = franchiseeIdParam;
    let detectedFranchisee = null;

    if (!franchiseeId && parseResult.companyId) {
      detectedFranchisee = await getFranchiseeByCompanyId(parseResult.companyId);
      if (detectedFranchisee) {
        franchiseeId = detectedFranchisee.id;
      }
    }

    if (!franchiseeId) {
      await logUploadFailure(auditContext, file.name, "franchisee_not_identified", {
        companyId: parseResult.companyId,
        periodStartDate,
        periodEndDate,
      });
      return NextResponse.json(
        { error: "Could not determine franchisee. Please provide franchiseeId or ensure the file contains a valid company ID." },
        { status: 400 }
      );
    }

    // Check for duplicates
    const duplicateCheck = await checkDuplicateBkmvUpload(franchiseeId, periodStartDate, periodEndDate);
    if (duplicateCheck.exists && !forceReplace) {
      await logUploadFailure(auditContext, file.name, "duplicate_period", {
        franchiseeId,
        periodStartDate,
        periodEndDate,
        existingFileId: duplicateCheck.existingFile!.id,
      });
      return NextResponse.json({
        error: "duplicate",
        message: "A file already exists for this franchisee and period",
        existingFile: {
          id: duplicateCheck.existingFile!.id,
          fileName: duplicateCheck.existingFile!.originalFileName,
          createdAt: duplicateCheck.existingFile!.createdAt,
          processingStatus: duplicateCheck.existingFile!.processingStatus,
        },
      }, { status: 409 });
    }

    // Get franchisee name for the file name
    let franchiseeName = "unknown";
    if (detectedFranchisee) {
      franchiseeName = detectedFranchisee.name;
    } else if (franchiseeIdParam) {
      const franchiseeData = await getFranchiseeById(franchiseeIdParam);
      if (franchiseeData) {
        franchiseeName = franchiseeData.name;
      }
    }

    // Generate descriptive file name with franchisee name and period
    let customFileName: string | undefined;
    try {
      customFileName = generateEntityFileName(
        franchiseeName,
        periodStartDate,
        file.name
      );
    } catch (nameError) {
      console.warn("Failed to generate entity filename, using default:", nameError);
      // Will use default filename from uploadDocument
    }

    // Upload file to storage
    const uploadResult = await uploadDocument(
      buffer,
      file.name,
      file.type || "application/octet-stream",
      "bkmvdata",
      franchiseeId,
      customFileName ? { customFileName } : undefined
    );

    // Create database record
    const fileId = randomUUID();
    const uploadedFileRecord = await createAdminUploadedFile({
      id: fileId,
      fileName: uploadResult.fileName,
      originalFileName: uploadResult.originalFileName,
      fileUrl: uploadResult.url,
      fileSize: uploadResult.fileSize,
      mimeType: uploadResult.mimeType,
      franchiseeId,
      periodStartDate,
      periodEndDate,
      uploadedByEmail: user.email,
      processingStatus: "processing",
    });

    // Process BKMVDATA with blacklist support
    const allSuppliers = await getSuppliers();
    const blacklistedNames = await getBlacklistedNamesSet();
    const smallSupplierNames = await getSmallSupplierNamesSet();
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
    const blacklistedCount = matchResults.filter(r => r.matchResult.matchType === "blacklisted").length;
    const exactMatches = classifiedResults.filter(r =>
      r.matchResult.matchedSupplier && r.matchResult.confidence === 1
    ).length;
    const fuzzyMatches = classifiedResults.filter(r =>
      r.matchResult.matchedSupplier && r.matchResult.confidence < 1
    ).length;
    const unmatched = classifiedResults.filter(r => !r.matchResult.matchedSupplier).length;

    // Admin upload = uploaded by the reviewer, so it's approved on save (same as
    // the admin-process path). Only public-link uploads go to needs_review.
    const processingStatus = "approved";

    // Build supplier ID map for monthly breakdown (maps BKMV name to matched supplier ID)
    // Only include exact matches (confidence === 1) — fuzzy matches should not be stored
    // as supplier associations in the year table to avoid false cross-references
    const supplierIdMap = new Map<string, string | null>();
    for (const r of matchResults) {
      const isExact = r.matchResult.matchedSupplier && r.matchResult.confidence === 1;
      supplierIdMap.set(r.bkmvName, isExact ? r.matchResult.matchedSupplier!.id : null);
    }

    // Build monthly breakdown for precise period matching
    const monthlyBreakdown = buildMonthlyBreakdown(parseResult.transactions, supplierIdMap);

    // Prepare processing result
    const storedResult: BkmvProcessingResult = {
      companyId: parseResult.companyId,
      fileVersion: parseResult.fileVersion,
      totalRecords: parseResult.totalRecords,
      dateRange: {
        startDate: periodStartDate,
        endDate: periodEndDate,
      },
      matchStats: {
        total: matchResults.length, // Total includes blacklisted items
        exactMatches,
        fuzzyMatches,
        unmatched,
        // Note: blacklisted items are counted separately (total - exactMatches - fuzzyMatches - unmatched = blacklisted)
      },
      matchedFranchiseeId: franchiseeId,
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
      processedAt: new Date().toISOString(),
    };

    // Update file with processing status and result
    await updateUploadedFileProcessingStatus(
      uploadedFileRecord.id,
      processingStatus,
      storedResult,
      user.id // approved by whoever uploaded it — keeps the review trail honest
    );

    // Archive to year-based BKMV table
    try {
      const { upsertFromFullBreakdown } = await import("@/data-access/franchisee-bkmv-year");
      const yearResult = await upsertFromFullBreakdown(
        franchiseeId,
        monthlyBreakdown,
        storedResult.supplierMatches,
        uploadedFileRecord.id
      );
      if (yearResult.skipped.length > 0) {
        console.log(`BKMV year archiving: skipped years ${yearResult.skipped.join(", ")} (complete)`);
      }
    } catch (yearError) {
      console.error("Error archiving BKMV year data:", yearError);
    }

    // Process cross-references
    let crossRefResult = null;
    try {
      crossRefResult = await processFranchiseeBkmvData(
        franchiseeId,
        parseResult,
        periodStartDate,
        periodEndDate,
        user.id
      );
    } catch (crossRefError) {
      console.error("Error processing cross-references:", crossRefError);
    }

    // Close any open BKMV file_request for this franchisee so reminder crons
    // (upload-reminders) stop nagging accountants/owners after admin upload.
    try {
      await markFranchiseeBkmvRequestSubmitted(franchiseeId);
    } catch (markError) {
      console.error("Error marking BKMV file_request as submitted:", markError);
    }

    return NextResponse.json({
      success: true,
      file: {
        id: uploadedFileRecord.id,
        fileName: uploadedFileRecord.originalFileName,
        fileUrl: uploadedFileRecord.fileUrl,
        processingStatus,
      },
      processing: {
        companyId: parseResult.companyId,
        periodStartDate,
        periodEndDate,
        totalSuppliers: matchResults.length,
        exactMatches,
        fuzzyMatches,
        unmatched,
      },
      crossReferences: crossRefResult ? {
        updated: crossRefResult.crossReferencesUpdated,
        created: crossRefResult.crossReferencesCreated,
        errors: crossRefResult.errors,
      } : null,
    });
  } catch (error) {
    console.error("Error in admin BKMVDATA upload:", error);
    if (auditContext) {
      await logUploadFailure(auditContext, auditFileName, "internal_error", {
        details: error instanceof Error ? error.message : "Unknown error",
      });
    }
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
