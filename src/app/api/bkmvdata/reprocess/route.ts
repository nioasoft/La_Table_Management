import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import {
  parseBkmvData,
  buildMonthlyBreakdown,
} from "@/lib/bkmvdata-parser";
import { getDocument } from "@/lib/storage";
import { database } from "@/db";
import { uploadedFile } from "@/db/schema";
import type { BkmvProcessingResult } from "@/db/schema";
import { isNotNull, sql, eq } from "drizzle-orm";
import { getSuppliers } from "@/data-access/suppliers";
import { getBlacklistedNamesSet } from "@/data-access/bkmvBlacklist";
import { getSmallSupplierNamesSet } from "@/data-access/bkmvSmallSuppliers";
import {
  reprocessBkmvFileRow,
  type BkmvReprocessContext,
} from "@/data-access/bkmv-reprocess";

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
          hasMonthlyBreakdown: !!(f.bkmvProcessingResult as BkmvProcessingResult)
            .monthlyBreakdown,
        })),
      });
    }

    if (force) {
      // Full rebuild path uses the shared per-file helper so logic stays
      // identical to the per-file POST /api/bkmvdata/review/[fileId]/reprocess.
      const ctx: BkmvReprocessContext = {
        allSuppliers: await getSuppliers(),
        blacklistedNames: await getBlacklistedNamesSet(),
        smallSupplierNames: await getSmallSupplierNamesSet(),
      };

      let processed = 0;
      let failed = 0;
      let manualMatchesPreserved = 0;
      const errors: Array<{ fileId: string; fileName: string; error: string }> = [];

      for (const file of filesToProcess) {
        const outcome = await reprocessBkmvFileRow(
          {
            id: file.id,
            fileUrl: file.fileUrl,
            franchiseeId: file.franchiseeId,
            bkmvProcessingResult:
              file.bkmvProcessingResult as BkmvProcessingResult | null,
            originalFileName: file.originalFileName,
          },
          ctx
        );

        if (outcome.success) {
          processed++;
          manualMatchesPreserved += outcome.manualMatchesPreserved;
        } else {
          failed++;
          errors.push({
            fileId: outcome.fileId,
            fileName: outcome.fileName,
            error: outcome.error,
          });
        }
      }

      return NextResponse.json({
        success: true,
        force,
        totalWithBkmv: allBkmvFiles.length,
        toProcess: filesToProcess.length,
        processed,
        failed,
        manualMatchesPreserved,
        errors: errors.length > 0 ? errors : undefined,
      });
    }

    // Legacy backfill path: only rebuild monthlyBreakdown for files missing it.
    let processed = 0;
    let failed = 0;
    const errors: Array<{ fileId: string; fileName: string; error: string }> = [];

    for (const file of filesToProcess) {
      try {
        const buffer = await getDocument(file.fileUrl);
        if (!buffer) {
          errors.push({
            fileId: file.id,
            fileName: file.originalFileName,
            error: "Failed to download file",
          });
          failed++;
          continue;
        }

        const parseResult = parseBkmvData(buffer);
        const existingResult = file.bkmvProcessingResult as BkmvProcessingResult;

        // Build supplier ID map from existing matches (no rematch in legacy mode).
        const supplierIdMap = new Map<string, string | null>();
        if (existingResult.supplierMatches) {
          for (const m of existingResult.supplierMatches) {
            supplierIdMap.set(m.bkmvName, m.matchedSupplierId);
          }
        }

        const monthlyBreakdown = buildMonthlyBreakdown(
          parseResult.transactions,
          supplierIdMap
        );

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

        if (file.franchiseeId && monthlyBreakdown) {
          try {
            const { upsertFromFullBreakdown } = await import(
              "@/data-access/franchisee-bkmv-year"
            );
            await upsertFromFullBreakdown(
              file.franchiseeId,
              monthlyBreakdown,
              existingResult.supplierMatches || null,
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

        processed++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        errors.push({
          fileId: file.id,
          fileName: file.originalFileName,
          error: errorMsg,
        });
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
