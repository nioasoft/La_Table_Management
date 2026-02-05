import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { parseBkmvData, buildMonthlyBreakdown } from "@/lib/bkmvdata-parser";
import { matchBkmvSuppliers } from "@/lib/supplier-matcher";
import { getSuppliers } from "@/data-access/suppliers";
import { getBlacklistedNamesSet } from "@/data-access/bkmvBlacklist";
import { getDocument } from "@/lib/storage";
import { database } from "@/db";
import { uploadedFile } from "@/db/schema";
import type { BkmvProcessingResult } from "@/db/schema";
import { isNotNull, sql } from "drizzle-orm";
import { eq } from "drizzle-orm";

/**
 * POST /api/bkmvdata/reprocess
 * Re-process BKMV files to rebuild supplierMatches and monthlyBreakdown.
 *
 * Admin/Super User only.
 *
 * Query params:
 *   dryRun=true - only count files that need reprocessing, don't update
 *   force=true  - rebuild ALL files (not just those missing monthlyBreakdown)
 *                 Updates both supplierMatches and monthlyBreakdown.
 *                 Preserves manual match overrides from previous review.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get("dryRun") === "true";
    const force = searchParams.get("force") === "true";

    // Find uploaded files that have bkmvProcessingResult
    const allBkmvFiles = await database
      .select({
        id: uploadedFile.id,
        fileUrl: uploadedFile.fileUrl,
        franchiseeId: uploadedFile.franchiseeId,
        bkmvProcessingResult: uploadedFile.bkmvProcessingResult,
        processingStatus: uploadedFile.processingStatus,
        periodStartDate: uploadedFile.periodStartDate,
        periodEndDate: uploadedFile.periodEndDate,
        originalFileName: uploadedFile.originalFileName,
      })
      .from(uploadedFile)
      .where(isNotNull(uploadedFile.bkmvProcessingResult));

    // Determine which files to process
    let filesToProcess;
    if (force) {
      filesToProcess = allBkmvFiles;
    } else {
      filesToProcess = allBkmvFiles.filter((f) => {
        const result = f.bkmvProcessingResult as BkmvProcessingResult;
        return !result.monthlyBreakdown;
      });
    }

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        force,
        totalWithBkmv: allBkmvFiles.length,
        toProcess: filesToProcess.length,
        files: filesToProcess.map((f) => ({
          id: f.id,
          fileName: f.originalFileName,
          franchiseeId: f.franchiseeId,
          periodStart: f.periodStartDate,
          periodEnd: f.periodEndDate,
          hasMonthlyBreakdown: !!(f.bkmvProcessingResult as BkmvProcessingResult).monthlyBreakdown,
        })),
      });
    }

    // Load suppliers and blacklist once for all files
    const allSuppliers = await getSuppliers();
    const blacklistedNames = await getBlacklistedNamesSet();

    let processed = 0;
    let failed = 0;
    let manualMatchesPreserved = 0;
    const errors: Array<{ fileId: string; fileName: string; error: string }> = [];

    for (const file of filesToProcess) {
      try {
        // Download file from storage
        const buffer = await getDocument(file.fileUrl);
        if (!buffer) {
          errors.push({ fileId: file.id, fileName: file.originalFileName, error: "Failed to download file" });
          failed++;
          continue;
        }

        // Re-parse BKMVDATA
        const parseResult = parseBkmvData(buffer);

        // Re-match suppliers
        const matchResults = matchBkmvSuppliers(
          parseResult.supplierSummary,
          allSuppliers,
          { minConfidence: 0.6, reviewThreshold: 1.0 },
          blacklistedNames
        );

        // Collect manual overrides from old supplierMatches (preserve admin edits)
        const existingResult = file.bkmvProcessingResult as BkmvProcessingResult;
        const manualOverrides = new Map<string, {
          matchedSupplierId: string;
          matchedSupplierName: string | null;
        }>();

        if (force && existingResult.supplierMatches) {
          for (const oldMatch of existingResult.supplierMatches) {
            if (oldMatch.matchType === "manual" && oldMatch.matchedSupplierId) {
              manualOverrides.set(oldMatch.bkmvName, {
                matchedSupplierId: oldMatch.matchedSupplierId,
                matchedSupplierName: oldMatch.matchedSupplierName,
              });
            }
          }
        }

        // Build supplier ID map, applying manual overrides
        const supplierIdMap = new Map<string, string | null>();
        for (const r of matchResults) {
          const manual = manualOverrides.get(r.bkmvName);
          if (manual) {
            supplierIdMap.set(r.bkmvName, manual.matchedSupplierId);
          } else {
            supplierIdMap.set(r.bkmvName, r.matchResult.matchedSupplier?.id || null);
          }
        }

        // Build monthly breakdown with consistent supplier ID map
        const monthlyBreakdown = buildMonthlyBreakdown(parseResult.transactions, supplierIdMap);

        if (force) {
          // Full rebuild: update both supplierMatches and monthlyBreakdown
          const newSupplierMatches = matchResults.map(r => {
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

          // Recalculate stats (excluding blacklisted)
          const nonBlacklisted = newSupplierMatches.filter(m => m.matchType !== "blacklisted");
          const exactMatches = nonBlacklisted.filter(m => m.matchedSupplierId && m.confidence === 1).length;
          const fuzzyMatches = nonBlacklisted.filter(m => m.matchedSupplierId && m.confidence < 1).length;
          const unmatched = nonBlacklisted.filter(m => !m.matchedSupplierId).length;

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
          };

          await database
            .update(uploadedFile)
            .set({
              bkmvProcessingResult: sql`${JSON.stringify(updatedResult)}::jsonb`,
            })
            .where(eq(uploadedFile.id, file.id));
        } else {
          // Legacy mode: only update monthlyBreakdown
          const updatedResult: BkmvProcessingResult = {
            ...existingResult,
            monthlyBreakdown,
          };

          await database
            .update(uploadedFile)
            .set({
              bkmvProcessingResult: sql`${JSON.stringify(updatedResult)}::jsonb`,
            })
            .where(eq(uploadedFile.id, file.id));
        }

        processed++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        errors.push({ fileId: file.id, fileName: file.originalFileName, error: errorMsg });
        failed++;
      }
    }

    return NextResponse.json({
      success: true,
      force,
      totalWithBkmv: allBkmvFiles.length,
      toProcess: filesToProcess.length,
      processed,
      failed,
      manualMatchesPreserved: force ? manualMatchesPreserved : undefined,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error in BKMV reprocess:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
