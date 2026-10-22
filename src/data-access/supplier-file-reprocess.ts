import { database } from "@/db";
import { supplierFileUpload, supplier, reconciliationSession } from "@/db/schema";
import type {
  SupplierFileProcessingResult,
  SupplierFileMapping,
} from "@/db/schema";
import { and, eq, isNull, ne } from "drizzle-orm";
import { getDocument } from "@/lib/storage";
import { processSupplierFile } from "@/lib/file-processor";
import { getCurrentVatRate } from "@/data-access/vatRates";
import { matchFranchiseeNamesFromFileWithAnomalies } from "@/data-access/franchisees";
import { getVatProductNames } from "@/data-access/supplier-products";
import { markSupplierSessionsStale } from "@/data-access/reconciliation-v2";
import { filesInOpenPeriods } from "@/lib/vat-reprocess-targets";
import { formatErrorForDisplay } from "@/lib/file-processing-errors";
import {
  getAllBlacklisted,
  normalizeSupplierFileName,
} from "@/data-access/supplier-file-blacklist";
import {
  type Anomaly,
  filterFileLevelAnomalies,
} from "@/types/file-anomalies";

/**
 * Merge acknowledgements from a previous anomaly set onto a fresh one,
 * keyed by anomaly code + headline message. Anomalies that no longer
 * occur are dropped (since reprocessing produced a different outcome).
 * An admin who already triaged a FILTERED_ROWS_BY_DOCTYPE warning shouldn't
 * be asked again on the same file.
 */
export function mergeAnomalyAcknowledgements(
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

export type ReprocessOk = {
  success: true;
  fileId: string;
  fileName: string;
  supplierId: string;
  before: { gross: number; net: number };
  after: { gross: number; net: number };
};

export type ReprocessErr = {
  success: false;
  fileId: string;
  fileName: string;
  error: string;
};

export type ReprocessResult = ReprocessOk | ReprocessErr;

type FileRow = {
  id: string;
  supplierId: string;
  originalFileName: string;
  fileUrl: string | null;
  processingResult: unknown;
  periodStartDate?: string | null;
  periodEndDate?: string | null;
};

export type SupplierConfig = {
  vatIncluded: boolean;
  vatExempt: boolean;
  code: string | null;
  fileMapping: SupplierFileMapping | null;
};

export type SupplierConfigCache = Map<string, SupplierConfig>;

/**
 * Re-run parser + franchisee matcher on a previously uploaded supplier file
 * and rewrite `processing_result`. Manual franchisee match overrides and
 * acknowledged anomalies survive the reprocess. Does not touch downstream
 * tables (commissions, reconciliation sessions).
 *
 * Single-file convenience wrapper around the same logic used by the bulk
 * /api/supplier-files/reprocess endpoint.
 */
export async function reprocessSupplierFileById(
  fileId: string
): Promise<ReprocessResult> {
  const [file] = await database
    .select({
      id: supplierFileUpload.id,
      supplierId: supplierFileUpload.supplierId,
      originalFileName: supplierFileUpload.originalFileName,
      fileUrl: supplierFileUpload.fileUrl,
      processingResult: supplierFileUpload.processingResult,
      periodStartDate: supplierFileUpload.periodStartDate,
      periodEndDate: supplierFileUpload.periodEndDate,
    })
    .from(supplierFileUpload)
    .where(eq(supplierFileUpload.id, fileId))
    .limit(1);

  if (!file) {
    return {
      success: false,
      fileId,
      fileName: "",
      error: "Supplier file not found",
    };
  }

  if (!file.fileUrl) {
    return {
      success: false,
      fileId: file.id,
      fileName: file.originalFileName,
      error: "Supplier file has no stored URL",
    };
  }

  const vatRate = await getCurrentVatRate();
  return reprocessFileRow(file as FileRow, vatRate, new Map() as SupplierConfigCache);
}

/**
 * Internal worker shared with the bulk endpoint so a list of files can reuse
 * the cached supplier config and the single VAT-rate lookup.
 */
export async function reprocessFileRow(
  file: FileRow,
  vatRate: number,
  supplierCache: SupplierConfigCache
): Promise<ReprocessResult> {
  try {
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
        return {
          success: false,
          fileId: file.id,
          fileName: file.originalFileName,
          error: "Supplier not found",
        };
      }

      supplierConfig = {
        vatIncluded: sup.vatIncluded ?? false,
        vatExempt: sup.vatExempt ?? false,
        code: sup.code ?? null,
        fileMapping: sup.fileMapping as SupplierFileMapping | null,
      };
      supplierCache.set(file.supplierId, supplierConfig);
    }

    const buffer = await getDocument(file.fileUrl!);
    if (!buffer) {
      return {
        success: false,
        fileId: file.id,
        fileName: file.originalFileName,
        error: "Failed to download file",
      };
    }

    const vatProductNames = supplierConfig.vatExempt
      ? await getVatProductNames(file.supplierId)
      : undefined;

    const processResult = await processSupplierFile(
      buffer,
      supplierConfig.fileMapping,
      supplierConfig.vatIncluded,
      vatRate,
      supplierConfig.code ?? undefined,
      supplierConfig.vatExempt,
      vatProductNames,
      // Filename-keyed parsers (PASTA_LA_CASA, קראק) read the branch from it
      file.originalFileName,
      {
        supplierId: file.supplierId,
        period:
          file.periodStartDate && file.periodEndDate
            ? { start: file.periodStartDate, end: file.periodEndDate }
            : undefined,
      }
    );

    if (!processResult.success || processResult.data.length === 0) {
      return {
        success: false,
        fileId: file.id,
        fileName: file.originalFileName,
        error: processResult.errors?.[0]
          ? formatErrorForDisplay(processResult.errors[0])
          : "Failed to process file",
      };
    }

    const matchOutcome = await matchFranchiseeNamesFromFileWithAnomalies(
      processResult.data
    );
    // "לא רלוונטי" rows stay blacklisted on reprocess, as on upload — רסטרטו's
    // "Totals" row otherwise came back as an unmatched franchisee.
    const blocked = new Set(
      (await getAllBlacklisted(file.supplierId)).map((b) => b.normalizedName)
    );
    const isBlocked = (name: string) => blocked.has(normalizeSupplierFileName(name));
    const matchedResults = matchOutcome.rows.map((r) =>
      isBlocked(r.franchisee)
        ? { ...r, matchResult: { ...r.matchResult, matchedFranchisee: null, confidence: 0, requiresReview: false } }
        : r
    );
    const matchAnomalies = matchOutcome.anomalies;

    const existingResult =
      file.processingResult as SupplierFileProcessingResult | null;
    const manualOverrides = new Map<
      string,
      { matchedFranchiseeId: string; matchedFranchiseeName: string | null }
    >();

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

    const getMatchType = (
      r: (typeof matchedResults)[0]
    ):
      | "exact"
      | "exact_code"
      | "fuzzy"
      | "manual"
      | "blacklisted"
      | "none" => {
      if (isBlocked(r.franchisee)) return "blacklisted";
      const manual = manualOverrides.get(r.franchisee);
      if (manual) return "manual";
      if (!r.matchResult.matchedFranchisee) return "none";
      if (r.matchResult.matchType === "exact_code") return "exact_code";
      if (r.matchResult.confidence === 1) return "exact";
      return "fuzzy";
    };

    const exactMatches = matchedResults.filter((r) => {
      const manual = manualOverrides.get(r.franchisee);
      if (manual) return true;
      return (
        r.matchResult.matchedFranchisee && r.matchResult.confidence === 1
      );
    }).length;
    const fuzzyMatches = matchedResults.filter(
      (r) =>
        !manualOverrides.has(r.franchisee) &&
        r.matchResult.matchedFranchisee &&
        r.matchResult.confidence < 1 &&
        !r.matchResult.requiresReview
    ).length;
    const unmatched = matchedResults.filter(
      (r) =>
        !manualOverrides.has(r.franchisee) &&
        !r.matchResult.matchedFranchisee &&
        !isBlocked(r.franchisee)
    ).length;

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
          matchedFranchiseeId:
            manual?.matchedFranchiseeId ??
            r.matchResult.matchedFranchisee?.id ??
            null,
          matchedFranchiseeName:
            manual?.matchedFranchiseeName ??
            r.matchResult.matchedFranchisee?.name ??
            null,
          confidence: manual ? 1 : r.matchResult.confidence,
          matchType: getMatchType(r),
          requiresReview: manual ? false : r.matchResult.requiresReview,
          preCalculatedCommission: r.preCalculatedCommission,
        };
      }),
      processedAt: new Date().toISOString(),
      // Match-level anomalies are filtered out — they're shown per-row in the
      // review UI and were the cause of stale "low confidence match" warnings
      // persisting after a manual match.
      anomalies: mergeAnomalyAcknowledgements(
        existingResult?.anomalies ?? [],
        filterFileLevelAnomalies([
          ...(processResult.anomalies ?? []),
          ...matchAnomalies,
        ])
      ),
    };

    const beforeGross = existingResult?.totalGrossAmount ?? 0;
    const beforeNet = existingResult?.totalNetAmount ?? 0;

    await database
      .update(supplierFileUpload)
      .set({
        processingResult: newResult,
        updatedAt: new Date(),
      })
      .where(eq(supplierFileUpload.id, file.id));

    return {
      success: true,
      fileId: file.id,
      fileName: file.originalFileName,
      supplierId: file.supplierId,
      before: { gross: beforeGross, net: beforeNet },
      after: {
        gross: newResult.totalGrossAmount,
        net: newResult.totalNetAmount,
      },
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

export type VatReprocessSummary = {
  /** Files whose stored gross moved — their sessions were flagged stale. */
  recalculated: number;
  failed: number;
};

/**
 * A VAT flag in the supplier card only reaches the parser, so a file uploaded
 * before the flag kept its old gross and the reconciliation gap never moved
 * (Vini Azrieli Q3-2026: Reut flagged a ₪260 item, ₪47 stayed). Re-run the
 * supplier's files in open periods and flag the sessions whose gross changed.
 * Closed periods (session completed / file approved) are left as signed off.
 * Commissions are computed on net, which a VAT flag never changes.
 */
export async function reprocessOpenFilesAfterVatChange(
  supplierId: string
): Promise<VatReprocessSummary> {
  const [files, sessions] = await Promise.all([
    database
      .select({
        id: supplierFileUpload.id,
        supplierId: supplierFileUpload.supplierId,
        originalFileName: supplierFileUpload.originalFileName,
        fileUrl: supplierFileUpload.fileUrl,
        processingResult: supplierFileUpload.processingResult,
        periodStartDate: supplierFileUpload.periodStartDate,
        periodEndDate: supplierFileUpload.periodEndDate,
      })
      .from(supplierFileUpload)
      .where(
        and(
          eq(supplierFileUpload.supplierId, supplierId),
          ne(supplierFileUpload.processingStatus, "rejected")
        )
      ),
    database
      .select({
        periodStartDate: reconciliationSession.periodStartDate,
        periodEndDate: reconciliationSession.periodEndDate,
        status: reconciliationSession.status,
      })
      .from(reconciliationSession)
      .where(
        and(
          eq(reconciliationSession.supplierId, supplierId),
          isNull(reconciliationSession.archivedAt)
        )
      ),
  ]);

  const placed = files.flatMap((f) =>
    f.fileUrl && f.periodStartDate && f.periodEndDate
      ? [{ ...f, periodStartDate: f.periodStartDate, periodEndDate: f.periodEndDate }]
      : []
  );
  // ponytail: re-runs every live file of an open period, not only the one the
  // session reads — a few downloads per save; narrow it if a supplier piles up re-uploads.
  const targets = filesInOpenPeriods(placed, sessions);

  const vatRate = await getCurrentVatRate();
  const cache: SupplierConfigCache = new Map();
  const summary: VatReprocessSummary = { recalculated: 0, failed: 0 };

  for (const file of targets) {
    const result = await reprocessFileRow(file, vatRate, cache);
    if (!result.success) {
      summary.failed++;
      console.error(
        `[vat-reprocess] supplier ${supplierId} file ${file.id} failed: ${result.error}`
      );
      continue;
    }
    if (result.after.gross === result.before.gross) continue;
    summary.recalculated++;
    await markSupplierSessionsStale(supplierId, file.periodStartDate, file.periodEndDate);
  }

  return summary;
}
