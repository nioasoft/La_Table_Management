import { NextRequest, NextResponse } from "next/server";
import { requireAuth, isAuthError, requireRole } from "@/lib/api-middleware";
import { parseBkmvData, extractDateRange, buildMonthlyBreakdown } from "@/lib/bkmvdata-parser";
import { matchBkmvSuppliers } from "@/lib/supplier-matcher";
import { getSuppliers } from "@/data-access/suppliers";
import { getFranchiseeByCompanyId, getFranchiseeById } from "@/data-access/franchisees";
import { generateEntityFileName } from "@/lib/storage";
import {
  createAdminUploadedFile,
  checkDuplicateBkmvUpload,
  updateUploadedFileProcessingStatus,
} from "@/data-access/uploadLinks";
import { processFranchiseeBkmvData } from "@/data-access/crossReferences";
import { getBlacklistedNamesSet } from "@/data-access/bkmvBlacklist";
import { randomUUID } from "crypto";
import type { BkmvProcessingResult } from "@/db/schema";
import { formatDateAsLocal } from "@/lib/date-utils";

/**
 * POST /api/bkmvdata/admin-process
 * Process a BKMVDATA file that was uploaded to Vercel Blob
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

    // Parse request body
    const body = await request.json();
    const {
      blobUrl,
      fileName,
      fileSize,
      franchiseeId: franchiseeIdParam,
      periodStartDate: periodStartDateParam,
      periodEndDate: periodEndDateParam,
      forceReplace,
    } = body;

    if (!blobUrl) {
      return NextResponse.json(
        { error: "No blob URL provided" },
        { status: 400 }
      );
    }

    // Fetch file from Vercel Blob
    const blobResponse = await fetch(blobUrl);
    if (!blobResponse.ok) {
      return NextResponse.json(
        { error: "Failed to fetch file from storage" },
        { status: 400 }
      );
    }

    const buffer = Buffer.from(await blobResponse.arrayBuffer());

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
    const periodStartDate = periodStartDateParam || (dateRange?.startDate ? formatDateAsLocal(dateRange.startDate) : undefined);
    const periodEndDate = periodEndDateParam || (dateRange?.endDate ? formatDateAsLocal(dateRange.endDate) : undefined);

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

    // Get franchisee name for descriptive file naming
    let franchiseeName = "unknown";
    if (detectedFranchisee) {
      franchiseeName = detectedFranchisee.name;
    } else if (franchiseeIdParam) {
      const franchiseeData = await getFranchiseeById(franchiseeIdParam);
      if (franchiseeData) {
        franchiseeName = franchiseeData.name;
      }
    }

    // Generate descriptive file name (for database record, file is already in Blob)
    let descriptiveFileName = fileName || "BKMVDATA.txt";
    try {
      descriptiveFileName = generateEntityFileName(
        franchiseeName,
        periodStartDate,
        fileName || "BKMVDATA.txt"
      );
    } catch (nameError) {
      console.warn("Failed to generate descriptive filename:", nameError);
      // Fall back to original filename
    }

    // Create database record (file is already in Vercel Blob)
    const fileId = randomUUID();
    const uploadedFileRecord = await createAdminUploadedFile({
      id: fileId,
      fileName: descriptiveFileName,
      originalFileName: fileName || "BKMVDATA.txt",
      fileUrl: blobUrl,
      fileSize: fileSize || buffer.length,
      mimeType: "text/plain",
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

    // Build supplier ID map for monthly breakdown
    const supplierIdMap = new Map<string, string | null>();
    for (const r of matchResults) {
      supplierIdMap.set(r.bkmvName, r.matchResult.matchedSupplier?.id || null);
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
        total: matchResults.length,
        exactMatches,
        fuzzyMatches,
        unmatched,
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
      processingStatus as "pending" | "processing" | "auto_approved" | "needs_review" | "approved" | "rejected",
      storedResult
    );

    // Process cross-references (pass pre-fetched data to avoid redundant queries)
    let crossRefResult = null;
    try {
      crossRefResult = await processFranchiseeBkmvData(
        franchiseeId,
        parseResult,
        periodStartDate,
        periodEndDate,
        user.id,
        {
          franchiseeName,
          matchResults: matchResults,
        }
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
    console.error("Error in admin BKMVDATA process:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
