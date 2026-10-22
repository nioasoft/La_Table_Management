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
  sweepRematchUnmatchedRows,
  syncCommissionsFromUpload,
  updateSupplierFileProcessing,
} from "@/data-access/supplier-file-uploads";
import type { SupplierFileUpload } from "@/db/schema";
import { autoApprovesAfterRowFix } from "@/lib/supplier-file-status";
import {
  addToBlacklist,
} from "@/data-access/supplier-file-blacklist";
import { getFranchiseeById } from "@/data-access/franchisees";
import { markSupplierSessionsStale } from "@/data-access/reconciliation-v2";

/**
 * A match change alters what the period's reconciliation session should hold
 * (a branch resolved in review was missing from it) — flag it so it's rebuilt.
 */
async function flagPeriodSessionsStale(
  file: { supplierId: string; periodStartDate: string | null; periodEndDate: string | null },
  userId: string
): Promise<void> {
  if (!file.periodStartDate || !file.periodEndDate) return;
  try {
    await markSupplierSessionsStale(file.supplierId, file.periodStartDate, file.periodEndDate, userId);
  } catch (staleErr) {
    console.error("Failed to flag reconciliation sessions stale after match change:", staleErr);
  }
}

const AUTO_APPROVED_NOTE = " — כל השורות מותאמות, הקובץ אושר אוטומטית";

/**
 * Upload-screen fixes only (reevaluateStatus): the anomaly dialog saves the
 * file before its rows are fixed, so once they are, it moves to auto_approved
 * like a file saved after the fixes would have.
 */
async function autoApproveIfResolved(file: SupplierFileUpload): Promise<boolean> {
  if (!file.processingResult || !autoApprovesAfterRowFix(file)) return false;
  return !!(await updateSupplierFileProcessing(file.id, file.processingResult, "auto_approved"));
}

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
      matchType: "none" | "exact" | "exact_code" | "fuzzy" | "manual" | "blacklisted";
      requiresReview: boolean;
    }> = [];

    if (file.processingResult?.franchiseeMatches) {
      enrichedMatches = await Promise.all(
        file.processingResult.franchiseeMatches.map(async (match) => {
          let franchiseeCode: string | null = null;
          let displayName = match.originalName;

          if (match.matchedFranchiseeId) {
            const franchisee = await getFranchiseeById(match.matchedFranchiseeId);
            franchiseeCode = franchisee?.code || null;

            // If matched by companyId/taxId (exact_code), use the franchisee name from system
            // instead of the raw name from the file (which may be an address or supplier-specific name)
            if (match.matchType === "exact_code" && franchisee) {
              displayName = franchisee.name;
            }
          }

          return {
            ...match,
            originalName: displayName,
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
    const { originalName, franchiseeId, addAsAlias, blacklist, notes, reevaluateStatus } = body;

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
      await flagPeriodSessionsStale(file, user.id);

      const autoApproved = reevaluateStatus === true && (await autoApproveIfResolved(updatedFile));

      return NextResponse.json({
        success: true,
        message: `השם "${originalName}" נוסף לרשימה השחורה${autoApproved ? AUTO_APPROVED_NOTE : ""}`,
        updatedStats: updatedFile.processingResult?.matchStats,
        autoApproved,
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
    let sweepNewlyMatched = 0;
    let aliasResult: Awaited<ReturnType<typeof addFranchiseeAlias>> | null = null;
    let finalStats = updatedFile.processingResult?.matchStats;
    let latestFile = updatedFile;
    if (addAsAlias) {
      aliasResult = await addFranchiseeAlias(franchiseeId, originalName);

      // After adding the alias, re-run matching across all rows in this file
      // that are still unmatched. The new alias may unlock other rows whose
      // names match it (e.g. "ויני רגבה" added as alias also matches a future
      // row "ויני רגבה - מבצע"). Without this sweep, the admin would need to
      // re-upload the file to see those rows match.
      const sweepResult = await sweepRematchUnmatchedRows(fileId);
      if (sweepResult) {
        sweepNewlyMatched = sweepResult.newlyMatchedCount;
        finalStats = sweepResult.file.processingResult?.matchStats;
        latestFile = sweepResult.file;
      }
    }

    // Re-sync commissions so the newly-matched row (and any swept rows) become
    // commission rows with the file as source_file_id.
    try {
      await syncCommissionsFromUpload(fileId, user.id);
    } catch (syncError) {
      console.error("Failed to sync commissions after manual match:", syncError);
    }
    await flagPeriodSessionsStale(file, user.id);

    const autoApproved = reevaluateStatus === true && (await autoApproveIfResolved(latestFile));

    let message: string;
    if (addAsAlias && aliasResult === "conflict") {
      // Match applied, but the alias was NOT learned — it already belongs to
      // another franchisee and sharing it would misroute future files.
      message = `התאמה עודכנה לזכיין ${franchisee.name}, אך הכינוי "${originalName}" לא נשמר — הוא כבר רשום אצל זכיין אחר (כינוי יכול להיות רשום רק במקום אחד)`;
    } else if (addAsAlias) {
      message =
        sweepNewlyMatched > 0
          ? `התאמה עודכנה והכינוי "${originalName}" נוסף לזכיין ${franchisee.name}. עוד ${sweepNewlyMatched} שורות תואמו אוטומטית.`
          : `התאמה עודכנה והכינוי "${originalName}" נוסף לזכיין ${franchisee.name}`;
    } else {
      message = `התאמה עודכנה לזכיין ${franchisee.name}`;
    }

    if (autoApproved) message += AUTO_APPROVED_NOTE;

    return NextResponse.json({
      success: true,
      message,
      updatedStats: finalStats,
      sweepNewlyMatched,
      autoApproved,
    });
  } catch (error) {
    console.error("Error updating supplier file match:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
