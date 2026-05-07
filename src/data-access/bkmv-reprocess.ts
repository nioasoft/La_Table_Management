import { database } from "@/db";
import { uploadedFile } from "@/db/schema";
import type { BkmvProcessingResult, Supplier } from "@/db/schema";
import { eq, sql } from "drizzle-orm";
import { getDocument } from "@/lib/storage";
import {
  parseBkmvData,
  buildMonthlyBreakdown,
  convertRevenueSummaryToArray,
  convertAllAccountsSummaryToArray,
  buildAllAccountsSummary,
  buildRevenueMonthlyBreakdown,
  mergeRevenueSummaryIntoAllAccounts,
} from "@/lib/bkmvdata-parser";
import { matchBkmvSuppliers } from "@/lib/supplier-matcher";
import { getSuppliers } from "@/data-access/suppliers";
import { getBlacklistedNamesSet } from "@/data-access/bkmvBlacklist";
import { getSmallSupplierNamesSet } from "@/data-access/bkmvSmallSuppliers";

export type BkmvReprocessOk = {
  success: true;
  fileId: string;
  fileName: string;
  manualMatchesPreserved: number;
};

export type BkmvReprocessErr = {
  success: false;
  fileId: string;
  fileName: string;
  error: string;
};

export type BkmvReprocessResult = BkmvReprocessOk | BkmvReprocessErr;

type FileRow = {
  id: string;
  fileUrl: string;
  franchiseeId: string | null;
  bkmvProcessingResult: BkmvProcessingResult | null;
  originalFileName: string;
};

export type BkmvReprocessContext = {
  allSuppliers: Supplier[];
  blacklistedNames: Set<string>;
  smallSupplierNames: Set<string>;
};

/**
 * Re-run the BKMV parser + supplier matcher on a single uploaded file and
 * rewrite `uploadedFile.bkmvProcessingResult`. Manual supplier matches are
 * preserved by `bkmvName`. Confirmed revenue account codes are preserved.
 * Caller is responsible for adjusting `processingStatus` afterward.
 *
 * Single-file convenience wrapper around the same logic used by the bulk
 * /api/bkmvdata/reprocess endpoint when force=true.
 */
export async function reprocessBkmvFileById(
  fileId: string
): Promise<BkmvReprocessResult> {
  const [file] = await database
    .select({
      id: uploadedFile.id,
      fileUrl: uploadedFile.fileUrl,
      franchiseeId: uploadedFile.franchiseeId,
      bkmvProcessingResult: uploadedFile.bkmvProcessingResult,
      originalFileName: uploadedFile.originalFileName,
    })
    .from(uploadedFile)
    .where(eq(uploadedFile.id, fileId))
    .limit(1);

  if (!file) {
    return { success: false, fileId, fileName: "", error: "File not found" };
  }

  if (!file.fileUrl) {
    return {
      success: false,
      fileId: file.id,
      fileName: file.originalFileName,
      error: "Stored file URL missing",
    };
  }

  if (!file.bkmvProcessingResult) {
    return {
      success: false,
      fileId: file.id,
      fileName: file.originalFileName,
      error: "File has no prior BKMV processing result",
    };
  }

  const ctx: BkmvReprocessContext = {
    allSuppliers: await getSuppliers(),
    blacklistedNames: await getBlacklistedNamesSet(),
    smallSupplierNames: await getSmallSupplierNamesSet(),
  };

  return reprocessBkmvFileRow(file as FileRow, ctx);
}

/**
 * Internal worker that does the heavy lifting. Exposed so the bulk endpoint
 * can reuse a single suppliers/blacklist/small-supplier load across N files.
 */
export async function reprocessBkmvFileRow(
  file: FileRow,
  ctx: BkmvReprocessContext
): Promise<BkmvReprocessResult> {
  try {
    if (!file.bkmvProcessingResult) {
      return {
        success: false,
        fileId: file.id,
        fileName: file.originalFileName,
        error: "File has no prior BKMV processing result",
      };
    }

    const buffer = await getDocument(file.fileUrl);
    if (!buffer) {
      return {
        success: false,
        fileId: file.id,
        fileName: file.originalFileName,
        error: "Failed to download file",
      };
    }

    const parseResult = parseBkmvData(buffer);

    const matchResults = matchBkmvSuppliers(
      parseResult.supplierSummary,
      ctx.allSuppliers,
      { minConfidence: 0.6, reviewThreshold: 1.0 },
      ctx.blacklistedNames,
      ctx.smallSupplierNames
    );

    const existingResult = file.bkmvProcessingResult;

    // Preserve manual overrides keyed by bkmvName.
    const manualOverrides = new Map<
      string,
      { matchedSupplierId: string; matchedSupplierName: string | null }
    >();
    if (existingResult.supplierMatches) {
      for (const oldMatch of existingResult.supplierMatches) {
        if (oldMatch.matchType === "manual" && oldMatch.matchedSupplierId) {
          manualOverrides.set(oldMatch.bkmvName, {
            matchedSupplierId: oldMatch.matchedSupplierId,
            matchedSupplierName: oldMatch.matchedSupplierName,
          });
        }
      }
    }

    const supplierIdMap = new Map<string, string | null>();
    for (const r of matchResults) {
      const manual = manualOverrides.get(r.bkmvName);
      if (manual) {
        supplierIdMap.set(r.bkmvName, manual.matchedSupplierId);
      } else {
        const isExact =
          r.matchResult.matchedSupplier && r.matchResult.confidence === 1;
        supplierIdMap.set(
          r.bkmvName,
          isExact ? r.matchResult.matchedSupplier!.id : null
        );
      }
    }

    const monthlyBreakdown = buildMonthlyBreakdown(
      parseResult.transactions,
      supplierIdMap
    );

    let manualMatchesPreserved = 0;
    const newSupplierMatches = matchResults.map((r) => {
      const manual = manualOverrides.get(r.bkmvName);
      if (manual) {
        manualMatchesPreserved++;
        return {
          bkmvName: r.bkmvName,
          amount: r.amount,
          transactionCount: r.transactionCount,
          matchedSupplierId: manual.matchedSupplierId,
          matchedSupplierName: manual.matchedSupplierName,
          confidence: 1,
          matchType: "manual",
          requiresReview: false,
        };
      }
      return {
        bkmvName: r.bkmvName,
        amount: r.amount,
        transactionCount: r.transactionCount,
        matchedSupplierId: r.matchResult.matchedSupplier?.id || null,
        matchedSupplierName: r.matchResult.matchedSupplier?.name || null,
        confidence: r.matchResult.confidence,
        matchType: r.matchResult.matchType,
        requiresReview: r.matchResult.requiresReview,
      };
    });

    const nonBlacklisted = newSupplierMatches.filter(
      (m) => m.matchType !== "blacklisted"
    );
    const exactMatches = nonBlacklisted.filter(
      (m) => m.matchedSupplierId && m.confidence === 1
    ).length;
    const fuzzyMatches = nonBlacklisted.filter(
      (m) => m.matchedSupplierId && m.confidence < 1
    ).length;
    const unmatched = nonBlacklisted.filter(
      (m) => !m.matchedSupplierId
    ).length;

    const revenueAccounts = convertRevenueSummaryToArray(
      parseResult.revenueSummary
    );

    const allAccountsMap = buildAllAccountsSummary(parseResult);
    mergeRevenueSummaryIntoAllAccounts(
      allAccountsMap,
      parseResult.revenueSummary
    );
    const revenueCodeSet = new Set(revenueAccounts.map((a) => a.accountCode));
    const allAccountSummaries = convertAllAccountsSummaryToArray(
      allAccountsMap
    ).map((a) => ({
      ...a,
      autoDetectedAsRevenue: revenueCodeSet.has(a.accountCode),
    }));

    const confirmedCodes =
      existingResult.confirmedRevenueAccountCodes ??
      (existingResult.confirmedRevenueAccountCode
        ? [existingResult.confirmedRevenueAccountCode]
        : undefined);

    if (confirmedCodes) {
      const confirmedSet = new Set(confirmedCodes);
      for (const ra of revenueAccounts) {
        ra.isConfirmed = confirmedSet.has(ra.accountCode);
      }
    }

    const revenueMonthlyBreakdown = buildRevenueMonthlyBreakdown(
      parseResult.revenueSummary,
      confirmedCodes
    );

    const updatedResult: BkmvProcessingResult = {
      ...existingResult,
      supplierMatches: newSupplierMatches,
      matchStats: {
        total: newSupplierMatches.length,
        exactMatches,
        fuzzyMatches,
        unmatched,
      },
      monthlyBreakdown,
      revenueAccounts,
      allAccountSummaries:
        allAccountSummaries.length > 0 ? allAccountSummaries : undefined,
      revenueMonthlyBreakdown,
    };

    await database
      .update(uploadedFile)
      .set({
        bkmvProcessingResult: sql`${JSON.stringify(updatedResult)}::jsonb`,
      })
      .where(eq(uploadedFile.id, file.id));

    if (file.franchiseeId && monthlyBreakdown) {
      try {
        const { upsertFromFullBreakdown } = await import(
          "@/data-access/franchisee-bkmv-year"
        );
        await upsertFromFullBreakdown(
          file.franchiseeId,
          monthlyBreakdown,
          newSupplierMatches,
          file.id
        );
      } catch (yearError) {
        console.error(
          "Error archiving BKMV year data for file",
          file.id,
          yearError
        );
      }
    }

    return {
      success: true,
      fileId: file.id,
      fileName: file.originalFileName,
      manualMatchesPreserved,
    };
  } catch (error) {
    return {
      success: false,
      fileId: file.id,
      fileName: file.originalFileName,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}
