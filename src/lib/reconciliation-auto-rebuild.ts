/**
 * Whether a stale reconciliation session may be rebuilt without asking anyone.
 *
 * A rebuild starts a fresh run from current data and archives the old one —
 * approvals, notes and review-queue items stay behind on the archived run. So
 * a session nobody has touched is rebuilt automatically the moment a newer
 * supplier file or BKMV lands (Biscotti Q3-2026: a re-upload left the session
 * on 1 of 5 branches and nobody pressed "בנה מחדש"); a session with human
 * work in it keeps the stale banner and waits for Reut.
 */

export interface SessionWorkFacts {
  status: string;
  fileApprovedAt: Date | null;
  fileRejectionReason: string | null;
  reviewQueueRows: number;
  comparisons: ReadonlyArray<{
    status: string;
    reviewedBy: string | null;
    reviewedAt: Date | null;
    reviewNotes: string | null;
    notes: string | null;
  }>;
}

const MANUAL_ROW_STATUSES = new Set(["manually_approved", "sent_to_review_queue"]);

const hasText = (s: string | null) => !!s && s.trim() !== "";

/** Why the session can't be auto-rebuilt (English, for logs), or null when it's safe. */
export function humanWorkReason(s: SessionWorkFacts): string | null {
  if (s.fileApprovedAt || s.status === "file_approved") return "file approved";
  if (hasText(s.fileRejectionReason) || s.status === "file_rejected") return "file rejected";
  if (s.reviewQueueRows > 0) return `${s.reviewQueueRows} review queue row(s)`;

  // reviewed_by is ON DELETE SET NULL, so reviewed_at and the status count too.
  const touched = s.comparisons.filter(
    (c) =>
      c.reviewedBy ||
      c.reviewedAt ||
      MANUAL_ROW_STATUSES.has(c.status) ||
      hasText(c.reviewNotes) ||
      hasText(c.notes)
  ).length;
  return touched > 0 ? `${touched} row(s) reviewed or annotated` : null;
}
