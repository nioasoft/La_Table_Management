import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError, requireRole } from "@/lib/api-middleware";
import { uploadDocument } from "@/lib/storage";
import { parseBkmvData, extractDateRange } from "@/lib/bkmvdata-parser";
import { matchBkmvSuppliers } from "@/lib/supplier-matcher";
import { getSuppliers } from "@/data-access/suppliers";
import { getFranchiseeByCompanyId } from "@/data-access/franchisees";
import {
  createAdminUploadedFile,
  checkDuplicateBkmvUpload,
  updateUploadedFileProcessingStatus,
} from "@/data-access/uploadLinks";
import { processFranchiseeBkmvData } from "@/data-access/crossReferences";
import { getBlacklistedNamesSet } from "@/data-access/bkmvBlacklist";
import { randomUUID } from "crypto";
import type { BkmvProcessingResult } from "@/db/schema";

/**
 * POST /api/bkmvdata/admin-upload
 * Admin upload of BKMVDATA file with automatic processing
 */
export async function POST(request: NextRequest) {
  try {
    // Auth check
    const authResult = await requireAuth(request);
    if (isAuthError(authResult)) return authResult;

    // Role check - admin or super_user only
    const roleResult = await requireRole(request, ["admin", "super_user"]);
    if (isAuthError(roleResult)) return roleResult;

    const { user } = authResult;

    // Parse multipart form data
    const formData = await request.formData();
    const file = formData.get("file") as File | null;
    const franchiseeIdParam = formData.get("franchiseeId") as string | null;
    const periodStartDateParam = formData.get("periodStartDate") as string | null;
    const periodEndDateParam = formData.get("periodEndDate") as string | null;
    const forceReplace = formData.get("forceReplace") === "true";

    if (!file) {
      return NextResponse.json(
        { error: "No file provided" },
        { status: 400 }
      );
    }

    // Read file buffer
    const buffer = Buffer.from(await file.arrayBuffer());

    // Parse BKMVDATA file
    let parseResult;
    try {
      parseResult = parseBkmvData(buffer);
    } catch (parseError) {
      return NextResponse.json(
        { error: "Failed to parse BKMVDATA file", details: parseError instanceof Error ? parseError.message : "Unknown error" },
        { status: 400 }
      );
    }

    // Extract date range from file or use provided dates
    const dateRange = extractDateRange(parseResult);
    const periodStartDate = periodStartDateParam || (dateRange?.startDate.toISOString().split("T")[0]);
    const periodEndDate = periodEndDateParam || (dateRange?.endDate.toISOString().split("T")[0]);

    if (!periodStartDate || !periodEndDate) {
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
      return NextResponse.json(
        { error: "Could not determine franchisee. Please provide franchiseeId or ensure the file contains a valid company ID." },
        { status: 400 }
      );
    }

    // Check for duplicates
    const duplicateCheck = await checkDuplicateBkmvUpload(franchiseeId, periodStartDate, periodEndDate);
    if (duplicateCheck.exists && !forceReplace) {
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

    // Upload file to storage
    const uploadResult = await uploadDocument(
      buffer,
      file.name,
      file.type || "application/octet-stream",
      "bkmvdata",
      franchiseeId
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
    const matchResults = matchBkmvSuppliers(
      parseResult.supplierSummary,
      allSuppliers,
      { minConfidence: 0.6, reviewThreshold: 1.0 },
      blacklistedNames
    );

    // Calculate match statistics (excluding blacklisted items)
    const nonBlacklistedResults = matchResults.filter(r => r.matchResult.matchType !== "blacklisted");
    const blacklistedCount = matchResults.length - nonBlacklistedResults.length;
    const exactMatches = nonBlacklistedResults.filter(r =>
      r.matchResult.matchedSupplier && r.matchResult.confidence === 1
    ).length;
    const fuzzyMatches = nonBlacklistedResults.filter(r =>
      r.matchResult.matchedSupplier && r.matchResult.confidence < 1
    ).length;
    const unmatched = nonBlacklistedResults.filter(r => !r.matchResult.matchedSupplier).length;

    // Determine processing status (blacklisted items don't count as unmatched)
    const shouldAutoApprove = exactMatches === nonBlacklistedResults.length && unmatched === 0;
    const processingStatus = shouldAutoApprove ? "auto_approved" : "needs_review";

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
      processedAt: new Date().toISOString(),
    };

    // Update file with processing status and result
    await updateUploadedFileProcessingStatus(
      uploadedFileRecord.id,
      processingStatus as "pending" | "processing" | "auto_approved" | "needs_review" | "approved" | "rejected",
      storedResult
    );

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
        autoApproved: shouldAutoApprove,
      },
      crossReferences: crossRefResult ? {
        updated: crossRefResult.crossReferencesUpdated,
        created: crossRefResult.crossReferencesCreated,
        errors: crossRefResult.errors,
      } : null,
    });
  } catch (error) {
    console.error("Error in admin BKMVDATA upload:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
