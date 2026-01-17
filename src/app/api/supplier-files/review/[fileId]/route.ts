import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getSupplierFileById,
  updateSupplierFileMatch,
  addFranchiseeAlias,
  markSupplierFileMatchAsBlacklisted,
} from "@/data-access/supplier-file-uploads";
import {
  addToBlacklist,
} from "@/data-access/supplier-file-blacklist";
import { getFranchiseeById } from "@/data-access/franchisees";

/**
 * GET /api/supplier-files/review/[fileId] - Get detailed file info for review
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { fileId } = await params;

    // Get file with details
    const file = await getSupplierFileById(fileId);
    if (!file) {
      return NextResponse.json(
        { error: "הקובץ לא נמצא" },
        { status: 404 }
      );
    }

    // Enrich franchisee matches with current franchisee info
    let enrichedMatches: Array<{
      originalName: string;
      rowNumber: number;
      grossAmount: number;
      netAmount: number;
      matchedFranchiseeId: string | null;
      matchedFranchiseeName: string | null;
      matchedFranchiseeCode: string | null;
      confidence: number;
      matchType: string;
      requiresReview: boolean;
    }> = [];

    if (file.processingResult?.franchiseeMatches) {
      enrichedMatches = await Promise.all(
        file.processingResult.franchiseeMatches.map(async (match) => {
          let franchiseeCode: string | null = null;
          if (match.matchedFranchiseeId) {
            const franchisee = await getFranchiseeById(match.matchedFranchiseeId);
            franchiseeCode = franchisee?.code || null;
          }
          return {
            ...match,
            matchedFranchiseeCode: franchiseeCode,
          };
        })
      );
    }

    return NextResponse.json({
      file: {
        id: file.id,
        fileName: file.originalFileName,
        fileSize: file.fileSize,
        fileUrl: file.fileUrl,
        uploadedAt: file.createdAt,
        processingStatus: file.processingStatus,
        reviewedBy: file.reviewedBy,
        reviewedByName: file.reviewedByName,
        reviewedByEmail: file.reviewedByEmail,
        reviewedAt: file.reviewedAt,
        reviewNotes: file.reviewNotes,
        createdBy: file.createdBy,
        createdByName: file.createdByName,
        createdByEmail: file.createdByEmail,
        periodStartDate: file.periodStartDate,
        periodEndDate: file.periodEndDate,
      },
      supplier: {
        id: file.supplierId,
        name: file.supplierName,
        code: file.supplierCode,
      },
      processingResult: file.processingResult
        ? {
            totalRows: file.processingResult.totalRows,
            processedRows: file.processingResult.processedRows,
            skippedRows: file.processingResult.skippedRows,
            totalGrossAmount: file.processingResult.totalGrossAmount,
            totalNetAmount: file.processingResult.totalNetAmount,
            vatAdjusted: file.processingResult.vatAdjusted,
            matchStats: file.processingResult.matchStats,
            processedAt: file.processingResult.processedAt,
          }
        : null,
      franchiseeMatches: enrichedMatches,
    });
  } catch (error) {
    console.error("Error fetching supplier file details:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/supplier-files/review/[fileId] - Update a franchisee match (manual matching)
 * Body: { originalName: string, franchiseeId: string, addAsAlias?: boolean }
 * Or for blacklisting: { originalName: string, blacklist: true, notes?: string }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const { fileId } = await params;
    const body = await request.json();
    const { originalName, franchiseeId, addAsAlias, blacklist, notes } = body;

    if (!originalName) {
      return NextResponse.json(
        { error: "שם מקורי הוא שדה חובה" },
        { status: 400 }
      );
    }

    // Get file
    const file = await getSupplierFileById(fileId);
    if (!file) {
      return NextResponse.json(
        { error: "הקובץ לא נמצא" },
        { status: 404 }
      );
    }

    if (!file.processingResult) {
      return NextResponse.json(
        { error: "לא נמצאו תוצאות עיבוד לקובץ זה" },
        { status: 400 }
      );
    }

    // Handle blacklist action
    if (blacklist === true) {
      // Add to blacklist table
      await addToBlacklist(
        originalName,
        user.id,
        notes || undefined,
        file.supplierId // Supplier-specific blacklist
      );

      // Mark in processing result as blacklisted
      const updatedFile = await markSupplierFileMatchAsBlacklisted(
        fileId,
        originalName
      );

      if (!updatedFile) {
        return NextResponse.json(
          { error: "לא נמצאה התאמה עם השם המבוקש" },
          { status: 404 }
        );
      }

      return NextResponse.json({
        success: true,
        message: `השם "${originalName}" נוסף לרשימה השחורה`,
        updatedStats: updatedFile.processingResult?.matchStats,
      });
    }

    // Handle manual match action
    if (!franchiseeId) {
      return NextResponse.json(
        { error: "מזהה זכיין הוא שדה חובה להתאמה ידנית" },
        { status: 400 }
      );
    }

    // Get the franchisee
    const franchisee = await getFranchiseeById(franchiseeId);
    if (!franchisee) {
      return NextResponse.json(
        { error: "הזכיין לא נמצא" },
        { status: 404 }
      );
    }

    // Update the match in processing result
    const updatedFile = await updateSupplierFileMatch(
      fileId,
      originalName,
      franchiseeId,
      franchisee.name
    );

    if (!updatedFile) {
      return NextResponse.json(
        { error: "לא נמצאה התאמה עם השם המבוקש" },
        { status: 404 }
      );
    }

    // Optionally add as alias to the franchisee
    if (addAsAlias) {
      await addFranchiseeAlias(franchiseeId, originalName);
    }

    return NextResponse.json({
      success: true,
      message: addAsAlias
        ? `התאמה עודכנה והכינוי "${originalName}" נוסף לזכיין ${franchisee.name}`
        : `התאמה עודכנה לזכיין ${franchisee.name}`,
      updatedStats: updatedFile.processingResult?.matchStats,
    });
  } catch (error) {
    console.error("Error updating supplier file match:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
