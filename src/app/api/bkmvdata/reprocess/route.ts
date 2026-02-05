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
 * Re-process BKMV files that are missing monthlyBreakdown.
 * Downloads each file, re-parses, re-matches suppliers, builds monthlyBreakdown,
 * and merges it into the existing bkmvProcessingResult.
 *
 * Admin/Super User only.
 *
 * Query params:
 *   dryRun=true - only count files that need reprocessing, don't update
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get("dryRun") === "true";

    // Find uploaded files that have bkmvProcessingResult but no monthlyBreakdown
    const filesToProcess = await database
      .select({
        id: uploadedFile.id,
        fileUrl: uploadedFile.fileUrl,
        franchiseeId: uploadedFile.franchiseeId,
        bkmvProcessingResult: uploadedFile.bkmvProcessingResult,
        periodStartDate: uploadedFile.periodStartDate,
        periodEndDate: uploadedFile.periodEndDate,
        originalFileName: uploadedFile.originalFileName,
      })
      .from(uploadedFile)
      .where(
        isNotNull(uploadedFile.bkmvProcessingResult)
      );

    // Filter to files missing monthlyBreakdown in application code
    // (JSONB path queries are complex in Drizzle, simpler to filter here)
    const filesMissingBreakdown = filesToProcess.filter((f) => {
      const result = f.bkmvProcessingResult as BkmvProcessingResult;
      return !result.monthlyBreakdown;
    });

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        totalWithBkmv: filesToProcess.length,
        missingMonthlyBreakdown: filesMissingBreakdown.length,
        files: filesMissingBreakdown.map((f) => ({
          id: f.id,
          fileName: f.originalFileName,
          franchiseeId: f.franchiseeId,
          periodStart: f.periodStartDate,
          periodEnd: f.periodEndDate,
        })),
      });
    }

    // Load suppliers and blacklist once for all files
    const allSuppliers = await getSuppliers();
    const blacklistedNames = await getBlacklistedNamesSet();

    let processed = 0;
    let failed = 0;
    const errors: Array<{ fileId: string; fileName: string; error: string }> = [];

    for (const file of filesMissingBreakdown) {
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

        // Re-match suppliers to get supplier ID mapping
        const matchResults = matchBkmvSuppliers(
          parseResult.supplierSummary,
          allSuppliers,
          { minConfidence: 0.6, reviewThreshold: 1.0 },
          blacklistedNames
        );

        // Build supplier ID map
        const supplierIdMap = new Map<string, string | null>();
        for (const r of matchResults) {
          supplierIdMap.set(r.bkmvName, r.matchResult.matchedSupplier?.id || null);
        }

        // Build monthly breakdown
        const monthlyBreakdown = buildMonthlyBreakdown(parseResult.transactions, supplierIdMap);

        // Merge into existing bkmvProcessingResult
        const existingResult = file.bkmvProcessingResult as BkmvProcessingResult;
        const updatedResult: BkmvProcessingResult = {
          ...existingResult,
          monthlyBreakdown,
        };

        // Update DB record
        await database
          .update(uploadedFile)
          .set({
            bkmvProcessingResult: sql`${JSON.stringify(updatedResult)}::jsonb`,
          })
          .where(eq(uploadedFile.id, file.id));

        processed++;
      } catch (err) {
        const errorMsg = err instanceof Error ? err.message : "Unknown error";
        errors.push({ fileId: file.id, fileName: file.originalFileName, error: errorMsg });
        failed++;
      }
    }

    return NextResponse.json({
      success: true,
      totalWithBkmv: filesToProcess.length,
      missingMonthlyBreakdown: filesMissingBreakdown.length,
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
