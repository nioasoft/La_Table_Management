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
import { getFranchiseeById } from "@/data-access/franchisees";
import { getSupplierById, updateSupplier } from "@/data-access/suppliers";
import { getFranchiseeRevenueCodesList } from "@/data-access/franchisee-revenue-codes";
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

    // Get saved revenue codes for this franchisee (for UI distinction: saved vs auto-detected)
    const franchiseeId = file.franchiseeId ?? (uploadLink?.entityType === "franchisee" ? uploadLink.entityId : null);
    const savedRevenueCodes = franchiseeId
      ? await getFranchiseeRevenueCodesList(franchiseeId)
      : [];

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
        monthlyBreakdown: processingResult.monthlyBreakdown ?? null,
        revenueMonthlyBreakdown: processingResult.revenueMonthlyBreakdown ?? null,
      } : null,
      supplierMatches: enrichedMatches,
      revenueAccounts: processingResult?.revenueAccounts || [],
      allAccountSummaries: processingResult?.allAccountSummaries || [],
      savedRevenueCodes,
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
 * 2. Remove an existing match: { bkmvName, unmatch: true }  → row reverts to no_match
 * 3. Revenue confirmation: { revenueAccountCode, saveRevenueToFranchisee }
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

    // Check if this is a revenue confirmation request (supports both single and multi-account)
    if (body.revenueAccountCode !== undefined || body.revenueAccountCodes !== undefined) {
      return handleRevenueConfirmation(fileId, body);
    }

    // Check if this is a small supplier marking request
    if (body.markAsSmallSupplier) {
      return handleSmallSupplierMarking(fileId, body.bkmvName);
    }

    // Otherwise, handle supplier match update (or removal)
    const { bkmvName, newSupplierId, addAsAlias, unmatch } = body;

    if (!bkmvName) {
      return NextResponse.json(
        { error: "bkmvName is required" },
        { status: 400 }
      );
    }
    // A match update needs a target supplier; an unmatch request does not.
    if (!unmatch && !newSupplierId) {
      return NextResponse.json(
        { error: "newSupplierId is required (or pass unmatch: true to remove the match)" },
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

    // Get the new supplier (only when (re)matching — not needed to unmatch)
    const newSupplier = unmatch ? null : await getSupplierById(newSupplierId);
    if (!unmatch && !newSupplier) {
      return NextResponse.json(
        { error: "Supplier not found" },
        { status: 404 }
      );
    }

    // Update the match in processing result.
    // unmatch → revert the row to no_match (clears the link for THIS file only;
    // supplier bkmvAliases are intentionally left untouched).
    const updatedMatches = processingResult.supplierMatches.map((match) => {
      if (match.bkmvName === bkmvName) {
        if (unmatch) {
          return {
            ...match,
            matchedSupplierId: null,
            matchedSupplierName: null,
            confidence: 0,
            matchType: "no_match",
            requiresReview: true,
          };
        }
        return {
          ...match,
          matchedSupplierId: newSupplier!.id,
          matchedSupplierName: newSupplier!.name,
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
          // When this name is in the current matches, use its mapped id — even if it
          // resolved to null via an unmatch. A plain `?? entry.supplierId` would keep
          // the OLD supplier id after an unmatch, leaving a phantom in the year archive
          // (the report reads monthlyBreakdown by supplierId). Only fall back to the
          // entry's existing id for names not present in the matches at all.
          supplierId: supplierIdMap.has(entry.supplierName)
            ? supplierIdMap.get(entry.supplierName) ?? null
            : entry.supplierId,
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

    // Optionally add as alias to the supplier.
    // Isolated in try/catch so a failure here doesn't roll back the match update above.
    let aliasUpdated = false;
    if (addAsAlias && newSupplier) {
      try {
        const existingAliases = newSupplier.bkmvAliases || [];
        if (!existingAliases.includes(bkmvName)) {
          await updateSupplier(newSupplierId, {
            bkmvAliases: [...existingAliases, bkmvName],
          });
        }
        aliasUpdated = true;
      } catch (aliasError) {
        console.error("Error adding bkmv alias to supplier:", aliasError);
      }
    }

    return NextResponse.json({
      success: true,
      aliasUpdated,
      message: unmatch
        ? `ההתאמה של "${bkmvName}" בוטלה`
        : addAsAlias && aliasUpdated
          ? `התאמה עודכנה והכינוי "${bkmvName}" נוסף לספק ${newSupplier!.name}`
          : addAsAlias && !aliasUpdated
            ? `התאמה עודכנה לספק ${newSupplier!.name} (הוספת כינוי נכשלה)`
            : `התאמה עודכנה לספק ${newSupplier!.name}`,
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
 * Handle revenue account confirmation (supports multi-account)
 */
async function handleRevenueConfirmation(
  fileId: string,
  body: {
    revenueAccountCode?: string | null;
    revenueAccountCodes?: string[];
    saveRevenueToFranchisee?: boolean; // Legacy — now always saves
  }
): Promise<NextResponse> {
  try {
    // Normalize to array of codes (support both single and multi-account)
    const accountCodes: string[] = body.revenueAccountCodes
      ?? (body.revenueAccountCode ? [body.revenueAccountCode] : []);

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

    // Validate all account codes exist in allAccountSummaries (preferred) or revenueAccounts (fallback)
    const confirmedCodesSet = new Set(accountCodes);
    const allAccounts = processingResult.allAccountSummaries || [];
    const revenueOnly = processingResult.revenueAccounts || [];
    for (const code of accountCodes) {
      const validInAll = allAccounts.find(a => a.accountCode === code);
      const validInRevenue = revenueOnly.find(a => a.accountCode === code);
      if (!validInAll && !validInRevenue) {
        return NextResponse.json(
          { error: `Invalid account code: ${code}` },
          { status: 400 }
        );
      }
    }

    // Update the revenue accounts - mark selected ones as confirmed
    // Also add newly-selected accounts from allAccountSummaries that aren't already in revenueAccounts
    const existingRevenueCodes = new Set((processingResult.revenueAccounts || []).map(a => a.accountCode));
    const updatedRevenueAccounts = [
      ...(processingResult.revenueAccounts || []).map(account => ({
        ...account,
        isConfirmed: confirmedCodesSet.has(account.accountCode),
      })),
      // Add accounts selected from allAccountSummaries that weren't already in revenueAccounts
      ...accountCodes
        .filter(code => !existingRevenueCodes.has(code))
        .map(code => {
          const allAccount = allAccounts.find(a => a.accountCode === code);
          return {
            accountCode: code,
            accountName: allAccount?.accountName || code,
            totalAmount: allAccount?.totalAmount || 0,
            transactionCount: allAccount?.transactionCount || 0,
            isConfirmed: true,
            monthlyBreakdown: allAccount?.monthlyBreakdown,
          };
        }),
    ];

    // Build revenueMonthlyBreakdown from ALL confirmed accounts' monthlyBreakdowns
    let revenueMonthlyBreakdown: Record<string, number> | undefined;
    if (accountCodes.length > 0) {
      const breakdown: Record<string, number> = {};
      for (const account of updatedRevenueAccounts) {
        if (!confirmedCodesSet.has(account.accountCode)) continue;
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
      confirmedRevenueAccountCodes: accountCodes.length > 0 ? accountCodes : undefined,
      confirmedRevenueAccountCode: accountCodes.length > 0 ? accountCodes[0] : null,
      revenueMonthlyBreakdown,
    };

    // Update file with new processing result
    await updateUploadedFileProcessingStatus(
      fileId,
      file.processingStatus as "pending" | "processing" | "auto_approved" | "needs_review" | "approved" | "rejected",
      updatedResult
    );

    // Always save revenue codes to franchisee — confirmed codes are the source of truth
    // Resolve franchiseeId: direct reference OR via upload link (same fallback as GET handler)
    let franchiseeId = file.franchiseeId;
    if (!franchiseeId && file.uploadLinkId) {
      const uploadLink = await getUploadLinkById(file.uploadLinkId);
      if (uploadLink?.entityType === "franchisee") {
        franchiseeId = uploadLink.entityId;
      }
    }
    if (franchiseeId) {
      const { setFranchiseeRevenueCodes } = await import("@/data-access/franchisee-revenue-codes");
      const codesToSave = accountCodes.map(code => {
        const account = updatedRevenueAccounts?.find(a => a.accountCode === code);
        return {
          accountCode: code,
          accountName: account?.accountName || null,
        };
      });
      await setFranchiseeRevenueCodes(franchiseeId, codesToSave);
    }

    const confirmedNames = accountCodes
      .map(code => updatedRevenueAccounts?.find(a => a.accountCode === code)?.accountName || code)
      .join(", ");

    return NextResponse.json({
      success: true,
      message: `חשבונות הכנסות "${confirmedNames}" אושרו ונשמרו לזכיין`,
      confirmedRevenueAccountCodes: accountCodes,
    });
  } catch (error) {
    console.error("Error confirming revenue account:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * Handle marking a BKMV name as small supplier in the processing result
 */
async function handleSmallSupplierMarking(
  fileId: string,
  bkmvName: string
): Promise<NextResponse> {
  try {
    if (!bkmvName) {
      return NextResponse.json(
        { error: "bkmvName is required" },
        { status: 400 }
      );
    }

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

    // Update the match type to "small_supplier"
    const updatedMatches = processingResult.supplierMatches.map((match) => {
      if (match.bkmvName === bkmvName) {
        return {
          ...match,
          matchType: "small_supplier",
          requiresReview: false,
        };
      }
      return match;
    });

    // Recalculate stats (small suppliers count as neither matched nor unmatched)
    const exactMatches = updatedMatches.filter(m => m.matchedSupplierId && m.confidence === 1).length;
    const fuzzyMatches = updatedMatches.filter(m => m.matchedSupplierId && m.confidence < 1).length;
    const unmatched = updatedMatches.filter(m => !m.matchedSupplierId && m.matchType !== "blacklisted" && m.matchType !== "small_supplier").length;

    const updatedResult: BkmvProcessingResult = {
      ...processingResult,
      supplierMatches: updatedMatches,
      matchStats: {
        total: updatedMatches.length,
        exactMatches,
        fuzzyMatches,
        unmatched,
      },
    };

    await updateUploadedFileProcessingStatus(
      fileId,
      file.processingStatus as "pending" | "processing" | "auto_approved" | "needs_review" | "approved" | "rejected",
      updatedResult
    );

    // Re-archive to year-based BKMV table
    const franchiseeId = file.franchiseeId;
    if (franchiseeId && updatedResult.monthlyBreakdown) {
      try {
        const { upsertFromFullBreakdown } = await import("@/data-access/franchisee-bkmv-year");
        await upsertFromFullBreakdown(
          franchiseeId,
          updatedResult.monthlyBreakdown,
          updatedResult.supplierMatches,
          fileId
        );
      } catch (yearError) {
        console.error("Error archiving BKMV year data:", yearError);
      }
    }

    return NextResponse.json({
      success: true,
      message: `"${bkmvName}" סומן כספק קטן ללא עמלה`,
      updatedStats: updatedResult.matchStats,
    });
  } catch (error) {
    console.error("Error marking small supplier:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
