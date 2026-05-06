import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { database } from "@/db";
import { supplierFileUpload, supplier } from "@/db/schema";
import type { SupplierFileProcessingResult, SupplierFileMapping } from "@/db/schema";
import { eq, isNotNull, and } from "drizzle-orm";
import { getDocument } from "@/lib/storage";
import { processSupplierFile } from "@/lib/file-processor";
import { getCurrentVatRate } from "@/data-access/vatRates";
import { matchFranchiseeNamesFromFileWithAnomalies } from "@/data-access/franchisees";
import { getVatProductNames } from "@/data-access/supplier-products";
import type { Anomaly } from "@/types/file-anomalies";

/**
 * Merge acknowledgements from a previous anomaly set onto a fresh one,
 * keyed by anomaly code + headline message. Anomalies that no longer
 * occur are dropped (since reprocessing produced a different outcome).
 * Useful when reprocessing a file: an admin who already triaged a
 * FILTERED_ROWS_BY_DOCTYPE warning shouldn't be asked again.
 */
function mergeAnomalyAcknowledgements(
  previous: Anomaly[],
  fresh: Anomaly[]
): Anomaly[] {
  if (previous.length === 0) return fresh;
  const ackIndex = new Map<string, Anomaly>();
  for (const p of previous) {
    if (p.acknowledged) ackIndex.set(`${p.code}::${p.messageHe}`, p);
  }
  return fresh.map((a) => {
    const prior = ackIndex.get(`${a.code}::${a.messageHe}`);
    if (!prior) return a;
    return {
      ...a,
      acknowledged: true,
      acknowledgedAt: prior.acknowledgedAt,
      acknowledgedBy: prior.acknowledgedBy,
    };
  });
}

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

    // Build query conditions
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

    // Only reprocess approved files (not rejected ones)
    // Include both auto_approved and approved statuses
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

    // Filter to only approved/auto_approved files
    const filesToProcess = files.filter(
      (f) => f.processingStatus === "auto_approved" || f.processingStatus === "approved"
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

    // Load VAT rate once
    const vatRate = await getCurrentVatRate();

    // Cache supplier data
    const supplierCache = new Map<string, {
      vatIncluded: boolean;
      vatExempt: boolean;
      code: string | null;
      fileMapping: SupplierFileMapping | null;
    }>();

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
      try {
        // Get supplier config (cached)
        let supplierConfig = supplierCache.get(file.supplierId);
        if (!supplierConfig) {
          const [sup] = await database
            .select({
              vatIncluded: supplier.vatIncluded,
              vatExempt: supplier.vatExempt,
              code: supplier.code,
              fileMapping: supplier.fileMapping,
            })
            .from(supplier)
            .where(eq(supplier.id, file.supplierId))
            .limit(1);

          if (!sup) {
            errors.push({ fileId: file.id, fileName: file.originalFileName, error: "Supplier not found" });
            failed++;
            continue;
          }

          supplierConfig = {
            vatIncluded: sup.vatIncluded ?? false,
            vatExempt: sup.vatExempt ?? false,
            code: sup.code ?? null,
            fileMapping: sup.fileMapping as SupplierFileMapping | null,
          };
          supplierCache.set(file.supplierId, supplierConfig);
        }

        // Download file from blob storage
        const buffer = await getDocument(file.fileUrl!);
        if (!buffer) {
          errors.push({ fileId: file.id, fileName: file.originalFileName, error: "Failed to download file" });
          failed++;
          continue;
        }

        // Load per-item VAT products if needed
        const vatProductNames = supplierConfig.vatExempt
          ? await getVatProductNames(file.supplierId)
          : undefined;

        // Re-parse with current parser logic
        const processResult = await processSupplierFile(
          buffer,
          supplierConfig.fileMapping,
          supplierConfig.vatIncluded,
          vatRate,
          supplierConfig.code ?? undefined,
          supplierConfig.vatExempt,
          vatProductNames
        );

        if (!processResult.success || processResult.data.length === 0) {
          errors.push({
            fileId: file.id,
            fileName: file.originalFileName,
            error: processResult.errors?.[0]?.message || "Failed to process file",
          });
          failed++;
          continue;
        }

        // Re-match franchisee names + recompute anomalies
        const matchOutcome = await matchFranchiseeNamesFromFileWithAnomalies(
          processResult.data
        );
        const matchedResults = matchOutcome.rows;
        const matchAnomalies = matchOutcome.anomalies;

        // Preserve manual match overrides from existing result
        const existingResult = file.processingResult as SupplierFileProcessingResult | null;
        const manualOverrides = new Map<string, {
          matchedFranchiseeId: string;
          matchedFranchiseeName: string | null;
        }>();

        if (existingResult?.franchiseeMatches) {
          for (const oldMatch of existingResult.franchiseeMatches) {
            if (oldMatch.matchType === "manual" && oldMatch.matchedFranchiseeId) {
              manualOverrides.set(oldMatch.originalName, {
                matchedFranchiseeId: oldMatch.matchedFranchiseeId,
                matchedFranchiseeName: oldMatch.matchedFranchiseeName,
              });
            }
          }
        }

        // Calculate match statistics
        const getMatchType = (r: typeof matchedResults[0]): "exact" | "exact_code" | "fuzzy" | "manual" | "blacklisted" | "none" => {
          const manual = manualOverrides.get(r.franchisee);
          if (manual) return "manual";
          if (!r.matchResult.matchedFranchisee) return "none";
          if (r.matchResult.matchType === "exact_code") return "exact_code";
          if (r.matchResult.confidence === 1) return "exact";
          return "fuzzy";
        };

        const exactMatches = matchedResults.filter(
          (r) => {
            const manual = manualOverrides.get(r.franchisee);
            if (manual) return true;
            return r.matchResult.matchedFranchisee && r.matchResult.confidence === 1;
          }
        ).length;
        const fuzzyMatches = matchedResults.filter(
          (r) => !manualOverrides.has(r.franchisee) && r.matchResult.matchedFranchisee && r.matchResult.confidence < 1 && !r.matchResult.requiresReview
        ).length;
        const unmatched = matchedResults.filter(
          (r) => !manualOverrides.has(r.franchisee) && !r.matchResult.matchedFranchisee
        ).length;

        // Build new processing result
        const newResult: SupplierFileProcessingResult = {
          totalRows: processResult.summary.totalRows,
          processedRows: processResult.summary.processedRows,
          skippedRows: processResult.summary.skippedRows,
          totalGrossAmount: processResult.summary.totalGrossAmount,
          totalNetAmount: processResult.summary.totalNetAmount,
          vatAdjusted: supplierConfig.vatIncluded,
          matchStats: {
            total: matchedResults.length,
            exactMatches,
            fuzzyMatches,
            unmatched,
          },
          franchiseeMatches: matchedResults.map((r) => {
            const manual = manualOverrides.get(r.franchisee);
            return {
              originalName: r.franchisee,
              rowNumber: r.rowNumber,
              grossAmount: r.grossAmount,
              netAmount: r.netAmount,
              matchedFranchiseeId: manual?.matchedFranchiseeId ?? r.matchResult.matchedFranchisee?.id ?? null,
              matchedFranchiseeName: manual?.matchedFranchiseeName ?? r.matchResult.matchedFranchisee?.name ?? null,
              confidence: manual ? 1 : r.matchResult.confidence,
              matchType: getMatchType(r),
              requiresReview: manual ? false : r.matchResult.requiresReview,
              preCalculatedCommission: r.preCalculatedCommission,
            };
          }),
          processedAt: new Date().toISOString(),
          // Refresh anomalies; preserve any acknowledgements on matching codes
          // by code+messageHe combo so the modal doesn't re-flag what was
          // already triaged on a previous run.
          anomalies: mergeAnomalyAcknowledgements(
            existingResult?.anomalies ?? [],
            [...(processResult.anomalies ?? []), ...matchAnomalies]
          ),
        };

        // Store before values for comparison
        const beforeGross = existingResult?.totalGrossAmount || 0;
        const beforeNet = existingResult?.totalNetAmount || 0;

        // Update DB
        await database
          .update(supplierFileUpload)
          .set({
            processingResult: newResult,
            updatedAt: new Date(),
          })
          .where(eq(supplierFileUpload.id, file.id));

        results.push({
          fileId: file.id,
          fileName: file.originalFileName,
          supplierId: file.supplierId,
          status: "updated",
          before: { gross: beforeGross, net: beforeNet },
          after: { gross: newResult.totalGrossAmount, net: newResult.totalNetAmount },
        });
        processed++;
      } catch (error) {
        const errorMsg = error instanceof Error ? error.message : "Unknown error";
        errors.push({ fileId: file.id, fileName: file.originalFileName, error: errorMsg });
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
