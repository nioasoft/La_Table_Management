import type { Franchisee } from "@/db/schema";
import { matchFranchiseeName } from "@/lib/franchisee-matcher";
import {
  decideFranchiseeAcceptance,
  formatVerdictForLog,
  type AcceptanceVerdict,
} from "@/lib/franchisee-match-acceptance";
import {
  findFranchiseeByCustomerNumber,
  findOperatingBrand,
} from "@/lib/franchisee-parent-map";
import { getClientParser, getInvoiceParser } from "@/lib/client-parsers";

/** Sentinel values the parser uses when it cannot identify the franchisee */
const UNKNOWN_FRANCHISEE_NAMES = new Set(["לא זוהה", ""]);

/**
 * Narrow a failure result to the "skip silently because the franchisee is
 * closed" variant. Used by every resolveFranchisee call site so the daily
 * Pluxee/Mishloha/etc. emails for closed branches don't pile up as
 * gmail_sync_log failures.
 */
export function isInactiveFranchiseeSkip(
  match: ResolveFranchiseeResult,
): match is Extract<
  ResolveFranchiseeResult,
  { ok: false; skipReason: "inactive_franchisee" }
> {
  return !match.ok && "skipReason" in match && match.skipReason === "inactive_franchisee";
}

export type ResolveFranchiseeResult =
  | {
      ok: true;
      franchiseeId: string;
      franchiseeName: string;
      confidence: number;
      /**
       * Layer 3 borderline flag. True when confidence is in the
       * [0.85, 0.95) band: the document still commits, but the inbox
       * row is marked `needs_review` so an admin double-checks the
       * franchisee assignment.
       */
      needsReview?: boolean;
    }
  | {
      ok: false;
      skipReason: "inactive_franchisee";
      /**
       * Name of the matched inactive franchisee, surfaced into the sync
       * log so an admin can confirm "yes, this branch is closed — Pluxee
       * is still sending us reports for it" without re-opening the email.
       */
      inactiveFranchiseeName: string;
      confidence: number;
    }
  | {
      ok: false;
      // Diagnostics: what was tried and why it failed. Surfaced into
      // gmail_sync_log.error_details so we can debug without asking the
      // user to forward the original email each time.
      extractedName?: string;
      filenameAttempt?: string;
      reason: string;
      /**
       * Best rejected verdict across all strategies (if any). Captures the
       * top candidates so an admin can see "we considered these franchisees
       * but the confidence was too low or ambiguous". Populated when
       * `decideFranchiseeAcceptance` returns a non-accepting verdict.
       */
      rejectedVerdict?: Extract<AcceptanceVerdict, { accept: false }>;
    };

export async function resolveFranchisee(
  buffer: Buffer,
  mimeType: string,
  parserCode: string,
  subject: string,
  franchisees: Franchisee[],
  attachmentFilename?: string,
  documentType: "client_report" | "commission_invoice" = "client_report",
  /**
   * Full franchisee list (active + inactive). When provided, a final
   * pass tries matching the extracted name against inactive entries; a
   * high-confidence hit returns the `inactive_franchisee` skip reason so
   * the caller can drop the email silently instead of failing daily for
   * a closed branch (e.g. Pluxee → קינג קונג מוצקין).
   */
  inactiveFranchisees?: Franchisee[]
): Promise<ResolveFranchiseeResult> {
  // Track the best rejected verdict across all strategies so the final
  // failure message can surface "we considered these candidates" instead
  // of just "no match found".
  let bestRejectedVerdict: Extract<AcceptanceVerdict, { accept: false }> | undefined;
  const recordRejection = (
    verdict: Extract<AcceptanceVerdict, { accept: false }>,
  ) => {
    if (
      !bestRejectedVerdict ||
      verdict.bestConfidence > bestRejectedVerdict.bestConfidence
    ) {
      bestRejectedVerdict = verdict;
    }
  };

  // Strategy 1: Parse document and use extracted franchisee name.
  // Critical: commission invoices (Mishloha, Wolt, etc.) have a SEPARATE
  // parser registered under getInvoiceParser — the sales/report parser has
  // different franchisee-extraction logic (issuer vs recipient).
  const parser =
    documentType === "commission_invoice"
      ? getInvoiceParser(parserCode)
      : getClientParser(parserCode);
  let extractedName: string | undefined;
  if (parser) {
    try {
      const parseResult = await parser(buffer, mimeType);
      if (
        parseResult.success &&
        parseResult.data?.franchiseeName &&
        !UNKNOWN_FRANCHISEE_NAMES.has(parseResult.data.franchiseeName)
      ) {
        extractedName = parseResult.data.franchiseeName;

        // Parent-legal-entity override (e.g. Pat Vini Azrieli → Natanzon
        // Azrieli Haifa). When the extracted name is a parent legal entity
        // that issues invoices on behalf of an operating-brand franchisee,
        // route the document to the operating brand rather than fuzzy-
        // matching the legal entity. Confirmed by Asaf 2026-04-30 for
        // Mishlocha invoice 157159 and applies here for the May 2026 Wolt
        // outage (memory: feedback-franchisee-resolution-rules).
        //
        // Content gate (2026-05-10): we now also require the operating-
        // brand keyword to appear in the parsed line items / rawText, so
        // documents that genuinely belong to the parent legal entity (no
        // mention of the operating brand) fall through to the fuzzy match
        // instead of being kidnapped to the operating-brand franchisee.
        const contentText = [
          parseResult.data.rawText ?? "",
          ...(parseResult.data.lineItems ?? []).map((li) => li.description ?? ""),
        ].join("\n");

        // Shared-legal-entity disambiguation (deterministic, highest
        // priority). When several franchisees share one legal entity + ח.פ
        // (HAAT: Pat Vini Azrieli + Natanzon Azrieli Haifa), the "לכבוד"
        // recipient is identical on every invoice and name/keyword matching
        // cannot tell them apart — the second one used to fall to the wrong
        // franchisee and get parked by the overwrite guard every month. The
        // client's own per-restaurant customer number ("מס. לקוח") is the
        // only reliable signal; route by it before any name-based logic.
        const customerNumberMatch = findFranchiseeByCustomerNumber(
          parserCode,
          contentText,
        );
        if (customerNumberMatch) {
          const target = franchisees.find(
            (f) => f.id === customerNumberMatch.franchiseeId,
          );
          if (target) {
            console.log(
              `[email-inbound] Customer-number override (${parserCode}): "${extractedName}" → "${customerNumberMatch.franchiseeName}"`,
            );
            return {
              ok: true,
              franchiseeId: customerNumberMatch.franchiseeId,
              franchiseeName: customerNumberMatch.franchiseeName,
              confidence: 1,
            };
          }
          console.warn(
            `[email-inbound] Customer-number matched "${customerNumberMatch.franchiseeName}" but that franchisee is not active — falling back`,
          );
        }

        const parentOverride = findOperatingBrand(extractedName, contentText);
        if (parentOverride) {
          const operatingFranchisee = franchisees.find(
            (f) => f.id === parentOverride.operatingFranchiseeId
          );
          if (operatingFranchisee) {
            console.log(
              `[email-inbound] Parent-map override: "${extractedName}" → "${parentOverride.operatingFranchiseeName}" (operating brand)`
            );
            return {
              ok: true,
              franchiseeId: parentOverride.operatingFranchiseeId,
              franchiseeName: parentOverride.operatingFranchiseeName,
              confidence: 1,
            };
          }
          // Operating-brand franchisee not active — fall through to fuzzy match.
          console.warn(
            `[email-inbound] Parent-map matched "${extractedName}" but operating franchisee ${parentOverride.operatingFranchiseeId} is not in the active list — falling back to fuzzy match`
          );
        }

        // Strict acceptance gate (replaces 2026-pre `minConfidence: 0.6`
        // first-match-wins behaviour). Anything < 0.85 or with a close
        // runner-up is rejected here; the email is held back instead of
        // being committed to the wrong franchisee.
        const match = matchFranchiseeName(extractedName, franchisees, {
          minConfidence: 0.7,
        });
        const verdict = decideFranchiseeAcceptance(match);
        if (verdict.accept) {
          console.log(
            `[email-inbound] Matched franchisee from document content: "${extractedName}" → "${verdict.franchiseeName}" @${verdict.confidence.toFixed(2)}${verdict.needsReview ? " [needs_review]" : ""}`
          );
          return {
            ok: true,
            franchiseeId: verdict.franchiseeId,
            franchiseeName: verdict.franchiseeName,
            confidence: verdict.confidence,
            needsReview: verdict.needsReview,
          };
        }
        recordRejection(verdict);
        console.warn(
          `[email-inbound] Document-content match rejected: ${formatVerdictForLog(verdict)} (extracted="${extractedName}")`
        );
      }
    } catch (err) {
      console.warn("[email-inbound] Pre-parse for franchisee extraction failed:", err);
    }
  }

  // Strategy 2: Extract branch name from attachment filename
  // Wolt filenames: "{branch}__sales_report__monthly__{start}__{end}.pdf"
  if (attachmentFilename) {
    const filenameMatch = matchFranchiseeFromFilename(
      attachmentFilename,
      franchisees,
      recordRejection,
    );
    if (filenameMatch) {
      console.log(
        `[email-inbound] Matched franchisee from filename: "${attachmentFilename}" → "${filenameMatch.franchiseeName}" @${filenameMatch.confidence.toFixed(2)}`
      );
      return { ok: true, ...filenameMatch };
    }
  }

  // Strategy 3: Fall back to subject matching
  const subjectMatch = matchFranchiseeFromSubject(
    subject,
    franchisees,
    recordRejection,
  );
  if (subjectMatch) {
    return { ok: true, ...subjectMatch };
  }

  // Strategy 4: Inactive-franchisee detection (silent-skip path).
  // When the active strategies failed but the extracted name (or filename,
  // or subject) high-confidence matches a CLOSED branch, we don't want to
  // keep failing daily for it. Drop the email silently and tell the admin
  // via the sync log that an inactive franchisee was matched.
  if (inactiveFranchisees && inactiveFranchisees.length > 0) {
    const allCandidates = [...franchisees, ...inactiveFranchisees];
    const inactiveAttempts = [
      extractedName,
      attachmentFilename,
      subject,
    ].filter((v): v is string => !!v && v.trim().length >= 3);

    for (const attempt of inactiveAttempts) {
      const result = matchFranchiseeName(attempt, allCandidates, {
        minConfidence: 0.7,
        includeInactive: true,
      });
      if (
        result.matchedFranchisee &&
        !result.matchedFranchisee.isActive &&
        result.confidence >= 0.85
      ) {
        return {
          ok: false,
          skipReason: "inactive_franchisee",
          inactiveFranchiseeName: result.matchedFranchisee.name,
          confidence: result.confidence,
        };
      }
    }
  }

  return {
    ok: false,
    extractedName,
    filenameAttempt: attachmentFilename,
    reason: extractedName
      ? `Extracted "${extractedName}" but no franchisee match passed the acceptance gate (≥0.85 confidence, no ambiguity)`
      : "Parser did not extract a franchisee name; filename and subject also did not pass the acceptance gate",
    rejectedVerdict: bestRejectedVerdict,
  };
}

/**
 * Try to match a franchisee from the attachment filename.
 * Handles patterns like:
 * - Wolt: "קינג קונג חדרה הכשר__sales_report__monthly__2026-03-01__2026-04-01.pdf"
 * - Generic: "branch_name_report.pdf"
 */
function matchFranchiseeFromFilename(
  filename: string,
  franchisees: Franchisee[],
  recordRejection?: (
    verdict: Extract<AcceptanceVerdict, { accept: false }>,
  ) => void,
): {
  franchiseeId: string;
  franchiseeName: string;
  confidence: number;
  needsReview: boolean;
} | null {
  if (!filename || franchisees.length === 0) return null;

  // Strip extension
  const withoutExt = filename.replace(/\.[^.]+$/, "");

  const tryCandidate = (
    candidate: string,
  ): {
    franchiseeId: string;
    franchiseeName: string;
    confidence: number;
    needsReview: boolean;
  } | null => {
    if (candidate.length < 3) return null;
    const result = matchFranchiseeName(candidate, franchisees, {
      minConfidence: 0.7,
    });
    const verdict = decideFranchiseeAcceptance(result);
    if (verdict.accept) {
      return {
        franchiseeId: verdict.franchiseeId,
        franchiseeName: verdict.franchiseeName,
        confidence: verdict.confidence,
        needsReview: verdict.needsReview,
      };
    }
    if (verdict.reason !== "no_match") {
      recordRejection?.(verdict);
    }
    return null;
  };

  // Split on double underscore — Wolt legacy: "{branch}__sales_report__..."
  const doubleUnderscoreParts = withoutExt.split("__");
  if (doubleUnderscoreParts.length > 1) {
    const found = tryCandidate(doubleUnderscoreParts[0].trim());
    if (found) return found;
  }

  // Wolt ezcount (File B): "<heb...>_<...>_<hebCity>_<date>_<time>_<hash>.pdf"
  // Filename may be all-Hebrew (e.g. "מינה_טומיי_חיפה_...") or include an
  // English business-name token (e.g. "נתנזון_NATANZON_חיפה_..."). In both
  // cases we collect the Hebrew tokens to build the branch candidate.
  const singleUnderscoreParts = withoutExt.split("_");
  const hebrewTokens = singleUnderscoreParts.filter((p) =>
    /^[\u0590-\u05FF][\u0590-\u05FF ]*$/.test(p)
  );
  if (hebrewTokens.length >= 1) {
    const found = tryCandidate(hebrewTokens.join(" ").trim());
    if (found) return found;
  }

  // Also try the full filename (minus extension) for less structured names
  const cleaned = withoutExt
    .replace(/[_-]+/g, " ")
    .replace(/\d{4}[-/]\d{2}[-/]\d{2}/g, "") // remove dates
    .replace(/\b(sales|report|monthly|invoice|חשבונית|דוח)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return tryCandidate(cleaned);
}

/**
 * Try to match a franchisee from the email subject.
 * Removes common prefixes/patterns to isolate the branch name.
 */
function matchFranchiseeFromSubject(
  subject: string,
  franchisees: Franchisee[],
  recordRejection?: (
    verdict: Extract<AcceptanceVerdict, { accept: false }>,
  ) => void,
): {
  franchiseeId: string;
  franchiseeName: string;
  confidence: number;
  needsReview: boolean;
} | null {
  if (!subject || franchisees.length === 0) return null;

  // Try the full subject first (after removing common prefixes)
  const cleanedSubject = subject
    // Standard forward/reply prefixes (English + Hebrew)
    .replace(/^(fwd?|re|fw|subject):\s*/gi, "")
    .replace(/\[העתק\]\s*/g, "")
    .replace(/\[העברה\]\s*/g, "")
    // Monthly report prefixes
    .replace(/ריכוז חיוב חודשי\s*[-–—]\s*/g, "")
    .replace(/דוח חודשי\s*(מתן ביס|תן ביס|סיבוס|pluxee|cibus|tenbis|וולט|wolt|האט|haat|משלוחה|חבר)\s*[-–—ל]?\s*/gi, "")
    .replace(/דוח חודשי\s*[-–—]\s*/g, "")
    .replace(/monthly\s+report\s*[-–—]\s*/gi, "")
    // Invoice subjects: "חשבונית מס 10013 מאת ..." → keep only what's after "מאת"
    .replace(/חשבונית\s+(?:מס\s*)?\d+\s+מאת\s*/g, "")
    // ezcount generic subjects: "EasyCount Invoice for HAAT" → no franchisee info
    .replace(/EasyCount\s+Invoice\s+for\s+\w+/gi, "")
    .trim();

  // Split by common delimiters and try each part
  const parts = cleanedSubject.split(/\s*[-–—|,]\s*/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length < 3) continue;

    const result = matchFranchiseeName(trimmed, franchisees, {
      minConfidence: 0.75,
    });
    const verdict = decideFranchiseeAcceptance(result);
    if (verdict.accept) {
      return {
        franchiseeId: verdict.franchiseeId,
        franchiseeName: verdict.franchiseeName,
        confidence: verdict.confidence,
        needsReview: verdict.needsReview,
      };
    }
    if (verdict.reason !== "no_match") {
      recordRejection?.(verdict);
    }
  }

  return null;
}

export function formatResolveFailure(
  failure: Extract<
    ResolveFranchiseeResult,
    { ok: false; reason: string }
  >,
  subject: string
): string {
  // Single-line, Hebrew-fronted, with English diagnostics tail. Stored in
  // gmail_sync_log.error_details — visible in the cron-monitor admin UI.
  const parts: string[] = [`לא זוהה זכיין מהמסמך או מנושא המייל: "${subject}"`];
  if (failure.extractedName) {
    parts.push(`extracted="${failure.extractedName}"`);
  }
  if (failure.filenameAttempt) {
    parts.push(`filename="${failure.filenameAttempt}"`);
  }
  parts.push(`reason=${failure.reason}`);
  if (failure.rejectedVerdict) {
    // Surface top candidates so the admin can see what was considered
    // and pick a franchisee manually (or update aliases) rather than
    // having to re-fetch and re-parse the email from scratch.
    parts.push(formatVerdictForLog(failure.rejectedVerdict));
  }
  return parts.join(" | ");
}
