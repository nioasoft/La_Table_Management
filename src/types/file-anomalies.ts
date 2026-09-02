/**
 * File Anomaly types — surfaces non-fatal issues from supplier-file processing
 * to the admin UI as a persistent pre-save modal.
 *
 * Two sources of anomalies:
 *   1. Parsers — emit during row iteration (e.g. rows skipped by status filter).
 *   2. Franchisee matcher — emit during business-ID / name resolution.
 *
 * The UI lists each anomaly, optionally requires acknowledgement, and may
 * offer 1-click corrective actions (e.g. update franchisee company_id).
 */

export type AnomalySeverity = "blocking" | "warning" | "info";

export type AnomalyCode =
  // Parser / file-level
  | "EMPTY_FILE"
  | "ALL_ROWS_FILTERED"
  | "FILTERED_ROWS_BY_DOCTYPE"
  | "DATES_NOT_EXTRACTED"
  | "MIXED_PERIODS"
  | "PERIOD_MISMATCH"
  | "DUPLICATE_FILE"
  | "NEGATIVE_AMOUNTS"
  | "ZERO_AMOUNT_FRANCHISEE"
  | "VAT_RATE_MISMATCH"
  | "SUPPLIER_HEADER_TOTAL_GAP"
  // Match-level
  | "UNKNOWN_BUSINESS_ID"
  | "BIZ_ID_MISMATCH"
  | "LOW_CONFIDENCE_MATCH"
  | "AMBIGUOUS_MATCH"
  | "INACTIVE_FRANCHISEE_MATCHED";

export type AnomalyAction =
  | {
      type: "update_franchisee_company_id";
      franchiseeId: string;
      franchiseeName: string;
      currentCompanyId: string | null;
      newCompanyId: string;
      labelHe: string;
    }
  | {
      type: "manual_match_required";
      labelHe: string;
    }
  | {
      type: "reject_file";
      labelHe: string;
    }
  | {
      type: "acknowledge_only";
      labelHe: string;
    };

/**
 * A short structured record describing one detected issue.
 * `messageHe` is the headline shown in the modal; `details` is rendered as a
 * collapsible panel by the UI.
 */
export interface Anomaly {
  code: AnomalyCode;
  severity: AnomalySeverity;
  /** Headline shown to the user (always Hebrew). */
  messageHe: string;
  /** Optional structured payload for UI rendering. */
  details?: Record<string, unknown>;
  /** Optional 1-click corrective actions. */
  suggestedActions?: AnomalyAction[];
  /** Affected source row numbers, if applicable. */
  affectedRowNumbers?: number[];
  /** ₪ impact if the anomaly relates to amounts. */
  affectedAmount?: number;
  /** True once the user has clicked "הבנתי" on this anomaly in the UI. */
  acknowledged?: boolean;
  /** Audit info — when/who acknowledged. */
  acknowledgedAt?: string;
  acknowledgedBy?: string;
}

/**
 * Match-level anomaly codes — issues surfaced by the franchisee matcher rather
 * than by the file parser. These are intentionally NOT shown in the pre-save
 * review modal because the same information is already presented in the
 * per-row review table on the next screen, where the admin can fix each row
 * individually (manual match, blacklist, update company_id, etc.).
 *
 * Keeping them in the modal generated noise and false alarms (warnings would
 * persist after a manual fix because the cached anomalies array wasn't
 * recomputed). The modal now focuses on file-level issues that genuinely
 * block save and aren't visible in the per-row UI.
 */
const MATCH_LEVEL_ANOMALY_CODES = new Set<AnomalyCode>([
  "UNKNOWN_BUSINESS_ID",
  "BIZ_ID_MISMATCH",
  "LOW_CONFIDENCE_MATCH",
  "AMBIGUOUS_MATCH",
  "INACTIVE_FRANCHISEE_MATCHED",
]);

export function isFileLevelAnomaly(a: Anomaly): boolean {
  return !MATCH_LEVEL_ANOMALY_CODES.has(a.code);
}

export function filterFileLevelAnomalies(anomalies: Anomaly[]): Anomaly[] {
  return anomalies.filter(isFileLevelAnomaly);
}
