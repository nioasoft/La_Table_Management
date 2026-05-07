import { database } from "@/db";
import { supplierFileUpload, supplier } from "@/db/schema";
import type {
  SupplierFileProcessingResult,
  SupplierFileMapping,
} from "@/db/schema";
import { eq } from "drizzle-orm";
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
      vatProductNames
    );

    if (!processResult.success || processResult.data.length === 0) {
      return {
        success: false,
        fileId: file.id,
        fileName: file.originalFileName,
        error:
          processResult.errors?.[0]?.message ?? "Failed to process file",
      };
    }

    const matchOutcome = await matchFranchiseeNamesFromFileWithAnomalies(
      processResult.data
    );
    const matchedResults = matchOutcome.rows;
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
        !manualOverrides.has(r.franchisee) && !r.matchResult.matchedFranchisee
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
      anomalies: mergeAnomalyAcknowledgements(
        existingResult?.anomalies ?? [],
        [...(processResult.anomalies ?? []), ...matchAnomalies]
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
