import type { Anomaly } from "@/types/file-anomalies";
import type { SupplierFileProcessingResult } from "@/db/schema";

/**
 * Status for a newly saved supplier file. Every row matching exactly is not
 * enough: a parser that silently dropped a whole franchisee block still has
 * only exact rows — its sum against the file's own grand total is the only
 * sign (תויות הצפון Q3-2026). Acknowledging the anomaly doesn't clear it.
 */
export function supplierFileUploadStatus(
  rowsNeedingReview: number,
  anomalies: Anomaly[] | undefined
): "auto_approved" | "needs_review" {
  const rowsLost = anomalies?.some((a) => a.code === "GRAND_TOTAL_MISMATCH") ?? false;
  return rowsNeedingReview === 0 && !rowsLost ? "auto_approved" : "needs_review";
}

/**
 * After a row is fixed on the upload screen, does the already-saved file move
 * to auto_approved? The anomaly dialog saves on confirm — before the admin
 * fixes rows — so the save-time status is stale (רסטרטו Q3-2026: "Totals"
 * blacklisted a minute after the save, the file still sat in approvals).
 * Same rule as the save; only a file still awaiting its first review moves.
 */
export function autoApprovesAfterRowFix(file: {
  processingStatus: string;
  reviewedAt: Date | null;
  processingResult: Pick<SupplierFileProcessingResult, "matchStats" | "anomalies"> | null;
}): boolean {
  if (file.processingStatus !== "needs_review" || file.reviewedAt) return false;
  const stats = file.processingResult?.matchStats;
  if (!stats) return false;
  return (
    supplierFileUploadStatus(stats.unmatched + stats.fuzzyMatches, file.processingResult?.anomalies) ===
    "auto_approved"
  );
}
