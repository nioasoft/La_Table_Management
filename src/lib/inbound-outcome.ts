/**
 * What a `processClientDocument` result MEANS, in one place.
 *
 * The pipeline decides this in four places — the body branch, the
 * attachment branch and the buffer branch of the inbound webhook, plus
 * `recordInboundReviewOutcome`. On 2026-08-11 commit 5ca317b taught the
 * review-board writer that a parser refusing to persist (`success` with no
 * document — 10bis "הודעת תשלום" remittance advices, the Cibus daily
 * snapshot, ezcount receipts) is a DECISION and not a failure. It did not
 * teach the three counter blocks, so those kept doing `errorCount++`.
 *
 * On 2026-09-09 that showed up as six 10bis payment notices logged `failed`
 * with the useless reason "שגיאה בעיבוד" and no review-board row at all —
 * indistinguishable, in the daily digest, from documents that were actually
 * lost. Same decision, four copies, one of them patched: hence this module.
 */

export interface ProcessOutcomeInput {
  success: boolean;
  document?: { id: string } | null;
  skippedDuplicate?: boolean;
  skippedConflict?: boolean;
}

export type InboundOutcome =
  /** A client_document row was written. */
  | "created"
  /** Already ingested — a re-delivery. Not an error. */
  | "duplicate"
  /** The parser deliberately refused to persist. Not an error. */
  | "skipped"
  /** A document already holds this slot from another source. Needs a human. */
  | "conflict"
  /** Genuinely lost — parse or resolution failure. */
  | "failed";

export function classifyProcessOutcome(
  result: ProcessOutcomeInput,
): InboundOutcome {
  if (result.skippedDuplicate) return "duplicate";
  if (result.success && result.document) return "created";
  // `success` with no document is the parser saying "this is not a document
  // I should store", which is exactly as intended and must never be counted
  // as an error — an error means something was lost.
  if (result.success) return "skipped";
  if (result.skippedConflict) return "conflict";
  return "failed";
}
