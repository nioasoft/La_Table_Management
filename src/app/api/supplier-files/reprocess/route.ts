import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { database } from "@/db";
import { supplierFileUpload } from "@/db/schema";
import type { SupplierFileProcessingResult } from "@/db/schema";
import { eq, isNotNull, and } from "drizzle-orm";
import { getCurrentVatRate } from "@/data-access/vatRates";
import {
  reprocessFileRow,
  type SupplierConfigCache,
} from "@/data-access/supplier-file-reprocess";

/**
 * POST /api/supplier-files/reprocess
 * Re-process supplier files to rebuild processing results with current parser logic.
 *
 * Admin/Super User only.
 *
 * Query params:
 *   supplierId  - only reprocess files for this supplier
 *   fileId      - reprocess a single file
 *   dryRun=true - preview which files would be reprocessed without updating
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { searchParams } = new URL(request.url);
    const dryRun = searchParams.get("dryRun") === "true";
    const filterSupplierId = searchParams.get("supplierId");
    const filterFileId = searchParams.get("fileId");

    const conditions = [
      isNotNull(supplierFileUpload.processingResult),
      isNotNull(supplierFileUpload.fileUrl),
    ];

    if (filterSupplierId) {
      conditions.push(eq(supplierFileUpload.supplierId, filterSupplierId));
    }

    if (filterFileId) {
      conditions.push(eq(supplierFileUpload.id, filterFileId));
    }

    const files = await database
      .select({
        id: supplierFileUpload.id,
        supplierId: supplierFileUpload.supplierId,
        originalFileName: supplierFileUpload.originalFileName,
        fileUrl: supplierFileUpload.fileUrl,
        processingResult: supplierFileUpload.processingResult,
        processingStatus: supplierFileUpload.processingStatus,
      })
      .from(supplierFileUpload)
      .where(and(...conditions));

    // Only reprocess approved files (auto_approved or manually approved); skip rejected/pending.
    // Exception: an explicit fileId is an intentional admin action — allow
    // needs_review too, so failed uploads can be re-run after a parser fix
    // (status is preserved; the file still goes through review/approval).
    const filesToProcess = files.filter(
      (f) =>
        f.processingStatus === "auto_approved" ||
        f.processingStatus === "approved" ||
        (filterFileId !== null && f.processingStatus === "needs_review")
    );

    if (dryRun) {
      return NextResponse.json({
        dryRun: true,
        totalFiles: files.length,
        toProcess: filesToProcess.length,
        files: filesToProcess.map((f) => {
          const result = f.processingResult as SupplierFileProcessingResult | null;
          return {
            id: f.id,
            supplierId: f.supplierId,
            fileName: f.originalFileName,
            status: f.processingStatus,
            currentGross: result?.totalGrossAmount || 0,
            currentNet: result?.totalNetAmount || 0,
          };
        }),
      });
    }

    const vatRate = await getCurrentVatRate();
    const supplierCache: SupplierConfigCache = new Map();

    let processed = 0;
    let failed = 0;
    const results: Array<{
      fileId: string;
      fileName: string;
      supplierId: string;
      status: string;
      before: { gross: number; net: number };
      after: { gross: number; net: number };
    }> = [];
    const errors: Array<{ fileId: string; fileName: string; error: string }> = [];

    for (const file of filesToProcess) {
      const outcome = await reprocessFileRow(
        {
          id: file.id,
          supplierId: file.supplierId,
          originalFileName: file.originalFileName,
          fileUrl: file.fileUrl,
          processingResult: file.processingResult,
        },
        vatRate,
        supplierCache
      );

      if (outcome.success) {
        results.push({
          fileId: outcome.fileId,
          fileName: outcome.fileName,
          supplierId: outcome.supplierId,
          status: "updated",
          before: outcome.before,
          after: outcome.after,
        });
        processed++;
      } else {
        errors.push({
          fileId: outcome.fileId,
          fileName: outcome.fileName,
          error: outcome.error,
        });
        failed++;
      }
    }

    return NextResponse.json({
      success: true,
      processed,
      failed,
      results,
      errors: errors.length > 0 ? errors : undefined,
    });
  } catch (error) {
    console.error("Error in supplier file reprocess:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
