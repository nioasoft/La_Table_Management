import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getUploadedFileById,
  getUploadLinkById,
  updateUploadedFileProcessingStatus,
} from "@/data-access/uploadLinks";
import { getFranchiseeById, updateFranchiseeRevenueAccount } from "@/data-access/franchisees";
import { getSupplierById, updateSupplier } from "@/data-access/suppliers";
import type { BkmvProcessingResult } from "@/db/schema";

/**
 * GET /api/bkmvdata/review/[fileId] - Get detailed file info for review
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { fileId } = await params;

    // Get file
    const file = await getUploadedFileById(fileId);
    if (!file) {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }

    // Get upload link for entity info (if exists)
    const uploadLink = file.uploadLinkId
      ? await getUploadLinkById(file.uploadLinkId)
      : null;

    // Get franchisee - either from direct reference or via upload link
    let franchisee = null;
    if (file.franchiseeId) {
      // Admin upload - direct franchisee reference
      franchisee = await getFranchiseeById(file.franchiseeId);
    } else if (uploadLink?.entityType === "franchisee") {
      // Franchisee upload - via upload link
      franchisee = await getFranchiseeById(uploadLink.entityId);
    }

    const processingResult = file.bkmvProcessingResult as BkmvProcessingResult | null;

    // Enrich supplier matches with current supplier info
    let enrichedMatches: Array<{
      bkmvName: string;
      amount: number;
      transactionCount: number;
      matchedSupplierId: string | null;
      matchedSupplierName: string | null;
      matchedSupplierCode: string | null;
      confidence: number;
      matchType: string;
      requiresReview: boolean;
    }> = [];

    if (processingResult?.supplierMatches) {
      enrichedMatches = await Promise.all(
        processingResult.supplierMatches.map(async (match) => {
          let supplierCode: string | null = null;
          if (match.matchedSupplierId) {
            const supplier = await getSupplierById(match.matchedSupplierId);
            supplierCode = supplier?.code || null;
          }
          return {
            ...match,
            matchedSupplierCode: supplierCode,
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
        uploadedByEmail: file.uploadedByEmail,
        processingStatus: file.processingStatus,
        reviewedBy: file.reviewedBy,
        reviewedAt: file.reviewedAt,
        reviewNotes: file.reviewNotes,
      },
      franchisee: franchisee ? {
        id: franchisee.id,
        name: franchisee.name,
        code: franchisee.code,
        revenueAccountCode: franchisee.revenueAccountCode,
      } : null,
      uploadLink: uploadLink ? {
        id: uploadLink.id,
        name: uploadLink.name,
        entityType: uploadLink.entityType,
      } : null,
      processingResult: processingResult ? {
        companyId: processingResult.companyId,
        fileVersion: processingResult.fileVersion,
        totalRecords: processingResult.totalRecords,
        dateRange: processingResult.dateRange,
        matchStats: processingResult.matchStats,
        processedAt: processingResult.processedAt,
        matchedFranchiseeId: processingResult.matchedFranchiseeId,
        confirmedRevenueAccountCode: processingResult.confirmedRevenueAccountCode,
      } : null,
      supplierMatches: enrichedMatches,
      revenueAccounts: processingResult?.revenueAccounts || [],
    });
  } catch (error) {
    console.error("Error fetching file details:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/bkmvdata/review/[fileId] - Update a supplier match or confirm revenue account
 *
 * Body options:
 * 1. Supplier match update: { bkmvName, newSupplierId, addAsAlias }
 * 2. Revenue confirmation: { revenueAccountCode, saveRevenueToFranchisee }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ fileId: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { fileId } = await params;
    const body = await request.json();

    // Check if this is a revenue confirmation request
    if (body.revenueAccountCode !== undefined) {
      return handleRevenueConfirmation(fileId, body);
    }

    // Otherwise, handle supplier match update
    const { bkmvName, newSupplierId, addAsAlias } = body;

    if (!bkmvName || !newSupplierId) {
      return NextResponse.json(
        { error: "bkmvName and newSupplierId are required" },
        { status: 400 }
      );
    }

    // Get file
    const file = await getUploadedFileById(fileId);
    if (!file) {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }

    const processingResult = file.bkmvProcessingResult as BkmvProcessingResult | null;
    if (!processingResult) {
      return NextResponse.json(
        { error: "No processing result found" },
        { status: 400 }
      );
    }

    // Get the new supplier
    const newSupplier = await getSupplierById(newSupplierId);
    if (!newSupplier) {
      return NextResponse.json(
        { error: "Supplier not found" },
        { status: 404 }
      );
    }

    // Update the match in processing result
    const updatedMatches = processingResult.supplierMatches.map((match) => {
      if (match.bkmvName === bkmvName) {
        return {
          ...match,
          matchedSupplierId: newSupplier.id,
          matchedSupplierName: newSupplier.name,
          confidence: 1, // Manual match = 100%
          matchType: "manual",
          requiresReview: false,
        };
      }
      return match;
    });

    // Recalculate stats
    const exactMatches = updatedMatches.filter(m => m.confidence === 1).length;
    const fuzzyMatches = updatedMatches.filter(m => m.matchedSupplierId && m.confidence < 1).length;
    const unmatched = updatedMatches.filter(m => !m.matchedSupplierId).length;

    // Build updated supplier ID map from all matches
    const supplierIdMap = new Map<string, string | null>();
    for (const match of updatedMatches) {
      supplierIdMap.set(match.bkmvName, match.matchedSupplierId);
    }

    // Rebuild monthlyBreakdown supplier IDs to stay in sync
    let updatedMonthlyBreakdown = processingResult.monthlyBreakdown;
    if (updatedMonthlyBreakdown) {
      const rebuilt: typeof updatedMonthlyBreakdown = {};
      for (const [month, suppliers] of Object.entries(updatedMonthlyBreakdown)) {
        rebuilt[month] = suppliers.map(entry => ({
          ...entry,
          supplierId: supplierIdMap.get(entry.supplierName) ?? entry.supplierId,
        }));
      }
      updatedMonthlyBreakdown = rebuilt;
    }

    const updatedResult: BkmvProcessingResult = {
      ...processingResult,
      supplierMatches: updatedMatches,
      matchStats: {
        total: updatedMatches.length,
        exactMatches,
        fuzzyMatches,
        unmatched,
      },
      monthlyBreakdown: updatedMonthlyBreakdown,
    };

    // Update file with new processing result
    await updateUploadedFileProcessingStatus(
      fileId,
      file.processingStatus as "pending" | "processing" | "auto_approved" | "needs_review" | "approved" | "rejected",
      updatedResult
    );

    // Re-archive to year-based BKMV table with updated matches
    const franchiseeId = file.franchiseeId;
    if (franchiseeId && updatedMonthlyBreakdown) {
      try {
        const { upsertFromFullBreakdown } = await import("@/data-access/franchisee-bkmv-year");
        await upsertFromFullBreakdown(
          franchiseeId,
          updatedMonthlyBreakdown,
          updatedResult.supplierMatches,
          fileId
        );
      } catch (yearError) {
        console.error("Error archiving BKMV year data:", yearError);
      }
    }

    // Optionally add as alias to the supplier
    if (addAsAlias) {
      const existingAliases = newSupplier.bkmvAliases || [];
      if (!existingAliases.includes(bkmvName)) {
        await updateSupplier(newSupplierId, {
          bkmvAliases: [...existingAliases, bkmvName],
        });
      }
    }

    return NextResponse.json({
      success: true,
      message: addAsAlias
        ? `התאמה עודכנה והכינוי "${bkmvName}" נוסף לספק ${newSupplier.name}`
        : `התאמה עודכנה לספק ${newSupplier.name}`,
      updatedStats: updatedResult.matchStats,
    });
  } catch (error) {
    console.error("Error updating match:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Handle revenue account confirmation
 */
async function handleRevenueConfirmation(
  fileId: string,
  body: { revenueAccountCode: string | null; saveRevenueToFranchisee?: boolean }
): Promise<NextResponse> {
  try {
    const { revenueAccountCode, saveRevenueToFranchisee } = body;

    // Get file
    const file = await getUploadedFileById(fileId);
    if (!file) {
      return NextResponse.json(
        { error: "File not found" },
        { status: 404 }
      );
    }

    const processingResult = file.bkmvProcessingResult as BkmvProcessingResult | null;
    if (!processingResult) {
      return NextResponse.json(
        { error: "No processing result found" },
        { status: 400 }
      );
    }

    // Validate the account code exists in the revenue accounts
    if (revenueAccountCode) {
      const validAccount = processingResult.revenueAccounts?.find(
        a => a.accountCode === revenueAccountCode
      );
      if (!validAccount) {
        return NextResponse.json(
          { error: "Invalid revenue account code" },
          { status: 400 }
        );
      }
    }

    // Update the revenue accounts - mark the selected one as confirmed
    const updatedRevenueAccounts = processingResult.revenueAccounts?.map(account => ({
      ...account,
      isConfirmed: account.accountCode === revenueAccountCode,
    }));

    // Build revenueMonthlyBreakdown from the confirmed account's monthlyBreakdown
    let revenueMonthlyBreakdown: Record<string, number> | undefined;
    if (revenueAccountCode && processingResult.revenueAccounts) {
      const breakdown: Record<string, number> = {};
      for (const account of processingResult.revenueAccounts) {
        if (account.accountCode !== revenueAccountCode) continue;
        if (account.monthlyBreakdown) {
          for (const [month, amount] of Object.entries(account.monthlyBreakdown)) {
            breakdown[month] = (breakdown[month] || 0) + amount;
          }
        }
      }
      if (Object.keys(breakdown).length > 0) {
        revenueMonthlyBreakdown = breakdown;
      }
    }

    const updatedResult: BkmvProcessingResult = {
      ...processingResult,
      revenueAccounts: updatedRevenueAccounts,
      confirmedRevenueAccountCode: revenueAccountCode,
      revenueMonthlyBreakdown,
    };

    // Update file with new processing result
    await updateUploadedFileProcessingStatus(
      fileId,
      file.processingStatus as "pending" | "processing" | "auto_approved" | "needs_review" | "approved" | "rejected",
      updatedResult
    );

    // Optionally save revenue account to franchisee for future auto-matching
    if (saveRevenueToFranchisee && file.franchiseeId) {
      await updateFranchiseeRevenueAccount(file.franchiseeId, revenueAccountCode);
    }

    const accountName = updatedRevenueAccounts?.find(a => a.accountCode === revenueAccountCode)?.accountName;

    return NextResponse.json({
      success: true,
      message: saveRevenueToFranchisee
        ? `חשבון הכנסות "${accountName || revenueAccountCode}" אושר ונשמר לזכיין`
        : `חשבון הכנסות "${accountName || revenueAccountCode}" אושר`,
      confirmedRevenueAccountCode: revenueAccountCode,
    });
  } catch (error) {
    console.error("Error confirming revenue account:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
