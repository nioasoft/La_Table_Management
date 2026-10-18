import type { Anomaly } from "@/types/file-anomalies";

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
