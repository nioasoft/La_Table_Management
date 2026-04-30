/**
 * Recovery script for supplier_file_upload rows whose processing_result is NULL.
 *
 * Background: prior to the strategic fix, the public-upload error path (and
 * occasionally the admin path) created supplier_file_upload rows with
 * processing_status='needs_review' AND processing_result=NULL whenever the
 * parser failed. The review UI rendered these as "לא זמין" (not available),
 * leaving them stuck in the queue with no way for the user to act.
 *
 * This script downloads the file from its blob URL, re-runs the appropriate
 * parser (custom or fileMapping-based), populates franchiseeMatches and
 * period dates, and updates the row in place. If parsing still fails, the
 * row is updated with an error envelope so the reviewer at least sees why.
 *
 * Usage:
 *   npx tsx scripts/reprocess-supplier-file.ts --file-id <uuid>           # one row
 *   npx tsx scripts/reprocess-supplier-file.ts --scan                     # all ghost rows
 *   npx tsx scripts/reprocess-supplier-file.ts --scan --dry-run           # preview only
 */

import "dotenv/config";
import { database } from "../src/db";
import {
  supplierFileUpload,
  type SupplierFileMapping,
  type SupplierFileProcessingResult,
  type SettlementPeriodType,
} from "../src/db/schema";
import { and, eq, isNull } from "drizzle-orm";
import { getSupplierById } from "../src/data-access/suppliers";
import { matchFranchiseeNamesFromFile } from "../src/data-access/franchisees";
import { processSupplierFile, getCurrentVatRate } from "../src/lib/file-processor";
import { getVatProductNames, syncSupplierProducts } from "../src/data-access/supplier-products";
import { getPeriodsForFrequency } from "../src/lib/settlement-periods";
import { formatDateAsLocal } from "../src/lib/date-utils";

interface ReprocessOutcome {
  fileId: string;
  fileName: string;
  supplierName: string | null;
  status: "auto_approved" | "needs_review" | "skipped" | "failed";
  message: string;
}

function buildErrorProcessingResult(error: string): SupplierFileProcessingResult {
  return {
    totalRows: 0,
    processedRows: 0,
    skippedRows: 0,
    totalGrossAmount: 0,
    totalNetAmount: 0,
    vatAdjusted: false,
    matchStats: { total: 0, exactMatches: 0, fuzzyMatches: 0, unmatched: 0 },
    franchiseeMatches: [],
    processedAt: new Date().toISOString(),
    error,
  };
}

async function reprocessFile(fileId: string, dryRun: boolean): Promise<ReprocessOutcome> {
  const [row] = await database
    .select()
    .from(supplierFileUpload)
    .where(eq(supplierFileUpload.id, fileId))
    .limit(1);

  if (!row) {
    return { fileId, fileName: "(unknown)", supplierName: null, status: "failed", message: "row not found" };
  }

  const supplier = await getSupplierById(row.supplierId);
  if (!supplier) {
    return { fileId, fileName: row.originalFileName, supplierName: null, status: "failed", message: "supplier not found" };
  }

  if (!row.fileUrl) {
    return { fileId, fileName: row.originalFileName, supplierName: supplier.name, status: "failed", message: "row has no file_url to fetch" };
  }

  console.log(`[reprocess] ${fileId} (${supplier.name} / ${row.originalFileName}) — downloading…`);
  const response = await fetch(row.fileUrl);
  if (!response.ok) {
    return {
      fileId,
      fileName: row.originalFileName,
      supplierName: supplier.name,
      status: "failed",
      message: `download failed: ${response.status} ${response.statusText}`,
    };
  }
  const buffer = Buffer.from(await response.arrayBuffer());

  const fileMapping = (supplier.fileMapping as SupplierFileMapping | null) ?? null;

  // processSupplierFile dispatches to a custom parser when supplier.code matches one,
  // so we don't need to hand-resolve the parser here.
  const vatRate = await getCurrentVatRate();
  const vatProductNames = supplier.vatExempt ? await getVatProductNames(supplier.id) : undefined;

  const processResult = await processSupplierFile(
    buffer,
    fileMapping,
    supplier.vatIncluded ?? false,
    vatRate,
    supplier.code ?? undefined,
    supplier.vatExempt ?? false,
    vatProductNames
  );

  if (!processResult.success || processResult.data.length === 0) {
    const errorMessage =
      processResult.errors?.[0]?.message ||
      (processResult.data.length === 0
        ? "לא נמצאו נתונים לעיבוד בקובץ"
        : "כשל בעיבוד קובץ הספק");

    if (!dryRun) {
      await database
        .update(supplierFileUpload)
        .set({
          processingResult: buildErrorProcessingResult(errorMessage),
          processingStatus: "needs_review",
          updatedAt: new Date(),
        })
        .where(eq(supplierFileUpload.id, fileId));
    }

    return {
      fileId,
      fileName: row.originalFileName,
      supplierName: supplier.name,
      status: "needs_review",
      message: `parser still fails — wrote error envelope: ${errorMessage}`,
    };
  }

  if (processResult.summary.extractedProducts?.length) {
    if (!dryRun) {
      await syncSupplierProducts(supplier.id, processResult.summary.extractedProducts);
    }
  }

  const matchedResults = await matchFranchiseeNamesFromFile(processResult.data);
  const exactMatches = matchedResults.filter(r => r.matchResult.matchedFranchisee && r.matchResult.confidence === 1).length;
  const fuzzyMatches = matchedResults.filter(r => r.matchResult.matchedFranchisee && r.matchResult.confidence < 1 && !r.matchResult.requiresReview).length;
  const needsReview = matchedResults.filter(r => r.matchResult.matchedFranchisee && r.matchResult.requiresReview).length;
  const unmatched = matchedResults.filter(r => !r.matchResult.matchedFranchisee).length;

  // Period dates (mirrors src/app/api/public/upload/[token]/route.ts:594-616)
  const datesInFile = processResult.data.map(r => r.date).filter((d): d is Date => d !== null);
  let periodStartDate: string | null = null;
  let periodEndDate: string | null = null;
  if (datesInFile.length > 0) {
    const earliest = datesInFile.reduce((min, d) => (d < min ? d : min), datesInFile[0]);
    const latest = datesInFile.reduce((max, d) => (d > max ? d : max), datesInFile[0]);
    periodStartDate = formatDateAsLocal(earliest);
    periodEndDate = formatDateAsLocal(latest);
  } else {
    const frequency = (supplier.settlementFrequency as SettlementPeriodType) || "quarterly";
    const fiscalYearStartMonth = supplier.fiscalYearStartMonth ?? 1;
    const periods = getPeriodsForFrequency(frequency, new Date(), 1, fiscalYearStartMonth);
    if (periods.length > 0) {
      periodStartDate = formatDateAsLocal(periods[0].startDate);
      periodEndDate = formatDateAsLocal(periods[0].endDate);
    }
  }

  const shouldAutoApprove = unmatched === 0 && needsReview === 0;
  const newStatus: "auto_approved" | "needs_review" = shouldAutoApprove ? "auto_approved" : "needs_review";

  const getMatchType = (r: typeof matchedResults[0]): "exact" | "exact_code" | "fuzzy" | "manual" | "blacklisted" | "none" => {
    if (!r.matchResult.matchedFranchisee) return "none";
    if (r.matchResult.matchType === "exact_code") return "exact_code";
    if (r.matchResult.confidence === 1) return "exact";
    return "fuzzy";
  };

  const storedResult: SupplierFileProcessingResult = {
    totalRows: processResult.summary.totalRows,
    processedRows: processResult.summary.processedRows,
    skippedRows: processResult.summary.skippedRows,
    totalGrossAmount: processResult.summary.totalGrossAmount,
    totalNetAmount: processResult.summary.totalNetAmount,
    vatAdjusted: supplier.vatIncluded ?? false,
    matchStats: {
      total: matchedResults.length,
      exactMatches,
      fuzzyMatches,
      unmatched,
    },
    franchiseeMatches: matchedResults.map(r => ({
      originalName: r.franchisee,
      rowNumber: r.rowNumber,
      grossAmount: r.grossAmount,
      netAmount: r.netAmount,
      matchedFranchiseeId: r.matchResult.matchedFranchisee?.id || null,
      matchedFranchiseeName: r.matchResult.matchedFranchisee?.name || null,
      confidence: r.matchResult.confidence,
      matchType: getMatchType(r),
      requiresReview: r.matchResult.requiresReview,
      preCalculatedCommission: r.preCalculatedCommission,
    })),
    processedAt: new Date().toISOString(),
  };

  if (!dryRun) {
    await database
      .update(supplierFileUpload)
      .set({
        processingResult: storedResult,
        processingStatus: newStatus,
        periodStartDate,
        periodEndDate,
        updatedAt: new Date(),
      })
      .where(eq(supplierFileUpload.id, fileId));
  }

  return {
    fileId,
    fileName: row.originalFileName,
    supplierName: supplier.name,
    status: newStatus,
    message: `total=${matchedResults.length} exact=${exactMatches} fuzzy=${fuzzyMatches} unmatched=${unmatched} period=${periodStartDate ?? "?"}→${periodEndDate ?? "?"}`,
  };
}

async function findGhostRows(): Promise<Array<{ id: string; fileName: string }>> {
  const rows = await database
    .select({ id: supplierFileUpload.id, fileName: supplierFileUpload.originalFileName })
    .from(supplierFileUpload)
    .where(and(
      eq(supplierFileUpload.processingStatus, "needs_review"),
      isNull(supplierFileUpload.processingResult)
    ));
  return rows;
}

async function main(): Promise<void> {
  const args = process.argv.slice(2);
  const dryRun = args.includes("--dry-run");
  const scan = args.includes("--scan");
  const fileIdFlag = args.indexOf("--file-id");
  const fileId = fileIdFlag >= 0 ? args[fileIdFlag + 1] : undefined;

  if (!scan && !fileId) {
    console.error("Usage: npx tsx scripts/reprocess-supplier-file.ts (--file-id <uuid> | --scan) [--dry-run]");
    process.exit(1);
  }

  const targets: string[] = [];
  if (fileId) targets.push(fileId);
  if (scan) {
    const ghosts = await findGhostRows();
    console.log(`[reprocess] scan found ${ghosts.length} ghost rows (needs_review + processing_result IS NULL)`);
    for (const g of ghosts) targets.push(g.id);
  }

  console.log(`[reprocess] dryRun=${dryRun} targets=${targets.length}`);

  const outcomes: ReprocessOutcome[] = [];
  for (const id of targets) {
    try {
      const outcome = await reprocessFile(id, dryRun);
      outcomes.push(outcome);
      console.log(`  ${outcome.status.padEnd(14)} ${outcome.fileId} ${outcome.supplierName ?? "?"} — ${outcome.message}`);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      outcomes.push({ fileId: id, fileName: "(error)", supplierName: null, status: "failed", message });
      console.error(`  failed         ${id} — ${message}`);
    }
  }

  const summary = {
    auto_approved: outcomes.filter(o => o.status === "auto_approved").length,
    needs_review: outcomes.filter(o => o.status === "needs_review").length,
    failed: outcomes.filter(o => o.status === "failed").length,
    skipped: outcomes.filter(o => o.status === "skipped").length,
  };
  console.log(`[reprocess] done — ${JSON.stringify(summary)}`);

  process.exit(summary.failed > 0 ? 1 : 0);
}

main().catch(err => {
  console.error("[reprocess] fatal:", err);
  process.exit(1);
});
