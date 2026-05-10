/**
 * Acceptance gate for inbound-email franchisee matching.
 *
 * Purpose: replace the silent "first match ≥0.6 wins" auto-commit that caused
 * the 2026-05-10 Hatt-Netanzon → Vini-Azrieli misattribution. Inbound emails
 * now auto-commit only when the match is clearly the best candidate; in any
 * ambiguous or low-confidence case, the email is held back instead of being
 * committed to the wrong franchisee.
 *
 * The matcher (`matchFranchiseeName`) computes confidence + alternatives.
 * This module is the call-site policy that decides whether to trust it.
 */

import type {
  AlternativeMatch,
  FranchiseeMatchResult,
} from "./franchisee-matcher";

export type AcceptanceVerdict =
  | {
      accept: true;
      franchiseeId: string;
      franchiseeName: string;
      confidence: number;
      /**
       * True when confidence is above the auto-commit floor but below the
       * "fully trusted" threshold (default 0.85 ≤ x < 0.95). The webhook
       * still creates the client_document, but flags the row as
       * `needs_review` in the inbox so an admin double-checks the match.
       */
      needsReview: boolean;
    }
  | {
      accept: false;
      reason: "no_match" | "low_confidence" | "ambiguous";
      bestConfidence: number;
      /** Best match + alternatives, sorted by confidence descending. */
      candidates: Array<{
        id: string;
        name: string;
        confidence: number;
      }>;
    };

export interface AcceptanceOptions {
  /**
   * Confidence below which we never auto-commit, even if it is the best
   * available match. Default 0.85.
   */
  minAcceptableConfidence: number;
  /**
   * Maximum gap between the top match and the runner-up below which the
   * match is considered ambiguous (and thus rejected for auto-commit).
   * Default 0.05 — i.e. if best=0.90 and runner-up=0.86, that's ambiguous.
   */
  ambiguityGap: number;
  /**
   * Confidence above which the match is "fully trusted" and committed
   * silently. Below this (but at/above minAcceptableConfidence) the
   * match commits but is flagged `needsReview`. Default 0.95.
   */
  borderlineConfidenceThreshold: number;
}

const DEFAULTS: AcceptanceOptions = {
  minAcceptableConfidence: 0.85,
  ambiguityGap: 0.05,
  borderlineConfidenceThreshold: 0.95,
};

/**
 * Decide whether a franchisee match should auto-commit or be flagged.
 *
 * Rules:
 *  - No match found → reject (`no_match`).
 *  - Best confidence < `minAcceptableConfidence` → reject (`low_confidence`).
 *  - Runner-up within `ambiguityGap` of best → reject (`ambiguous`).
 *  - Otherwise → accept.
 */
export function decideFranchiseeAcceptance(
  result: FranchiseeMatchResult,
  options: Partial<AcceptanceOptions> = {},
): AcceptanceVerdict {
  const cfg: AcceptanceOptions = { ...DEFAULTS, ...options };

  if (!result.matchedFranchisee) {
    return {
      accept: false,
      reason: "no_match",
      bestConfidence: 0,
      candidates: [],
    };
  }

  const best = {
    id: result.matchedFranchisee.id,
    name: result.matchedFranchisee.name,
    confidence: result.confidence,
  };
  const candidates = [best, ...alternativesAsCandidates(result.alternatives)];

  if (result.confidence < cfg.minAcceptableConfidence) {
    return {
      accept: false,
      reason: "low_confidence",
      bestConfidence: result.confidence,
      candidates,
    };
  }

  const runnerUp = result.alternatives[0];
  if (runnerUp && result.confidence - runnerUp.confidence < cfg.ambiguityGap) {
    return {
      accept: false,
      reason: "ambiguous",
      bestConfidence: result.confidence,
      candidates,
    };
  }

  return {
    accept: true,
    franchiseeId: result.matchedFranchisee.id,
    franchiseeName: result.matchedFranchisee.name,
    confidence: result.confidence,
    needsReview: result.confidence < cfg.borderlineConfidenceThreshold,
  };
}

function alternativesAsCandidates(
  alternatives: AlternativeMatch[],
): Array<{ id: string; name: string; confidence: number }> {
  return alternatives.map((a) => ({
    id: a.franchisee.id,
    name: a.franchisee.name,
    confidence: a.confidence,
  }));
}

/**
 * Format a verdict's candidates for inclusion in `gmail_sync_log.error_details`.
 * One-line, Hebrew-readable.
 */
export function formatVerdictForLog(verdict: AcceptanceVerdict): string {
  if (verdict.accept) {
    return `accepted ${verdict.franchiseeName} @${verdict.confidence.toFixed(2)}`;
  }
  const reasonHe: Record<typeof verdict.reason, string> = {
    no_match: "לא נמצא זכיין",
    low_confidence: "ביטחון נמוך מדי",
    ambiguous: "מועמד מעורפל",
  };
  const candidatesStr = verdict.candidates
    .slice(0, 3)
    .map((c) => `${c.name}@${c.confidence.toFixed(2)}`)
    .join(", ");
  return `${reasonHe[verdict.reason]} (best ${verdict.bestConfidence.toFixed(2)}; candidates: ${candidatesStr || "none"})`;
}
