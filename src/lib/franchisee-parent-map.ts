/**
 * Parent-legal-entity → operating-brand franchisee mapping.
 *
 * Some clients (notably Wolt and Mishlocha) issue invoices addressed to a
 * legal entity ("פט ויני עזריאלי בע\"מ") even though the actual commercial
 * activity belongs to a different operating-brand franchisee ("נתנזון
 * עזריאלי חיפה"). Per Asaf's 2026-04-30 confirmation (memory:
 * feedback-franchisee-resolution-rules), the document must route to the
 * operating-brand franchisee.
 *
 * Each pair stores BOTH the parent name (as it appears in invoice "לכבוד"
 * lines) and the franchisee_id of the operating-brand franchisee in the
 * `franchisee` table. Keep this list explicit — do not auto-discover.
 *
 * To add a pair, ask Asaf first and reference the source incident.
 */

export interface ParentBrandPair {
  /** Legal-entity name as it appears in "לכבוד" / invoice recipient blocks */
  parentName: string;
  /** Aliases / variants of the parent name to also match. */
  parentAliases?: readonly string[];
  /** franchisee.id of the operating-brand franchisee */
  operatingFranchiseeId: string;
  /** Operating-brand franchisee.name for logging */
  operatingFranchiseeName: string;
  /**
   * Content markers — at least ONE must appear in line-item text / raw
   * text for the override to fire. Required to prevent the rule from
   * kidnapping documents that legitimately belong to the parent legal
   * entity. Include both Hebrew and Latin spellings: HAAT documents carry
   * the brand in English only ("Natanzon Burger"), Mishloha line items in
   * Hebrew ("נתנזון בורגר חיפה") — the May 2026 incident slipped through
   * because only the Hebrew form was checked.
   *
   * Example: an HAAT income invoice issued by "פאט ויני עזריאלי בע\"מ"
   * to "Haat Delivery" with only a single generic line item
   * ("סה\"כ אשראי חיוב במע\"מ") has no "נתנזון בורגר" reference, so the
   * override should NOT fire — that document belongs to Pat Vini, not
   * Natanzon, and must fall through to normal fuzzy matching.
   */
  requiredOperatingKeywords: readonly string[];
  /**
   * Content markers that BLOCK the override even when the operating
   * keyword is present. Used for mixed invoices where two brands share
   * the same legal entity issuer — a single document can list both
   * "ויני חיפה" and "נתנזון בורגר" line items, and the right home for
   * the row is determined by which side dominates. Anything in this
   * list signals that the parent (Vini) operates here in its OWN name,
   * so we must not silently route to Natanzon.
   */
  blockingContentKeywords?: readonly string[];
  /** Why this pair exists (audit trail). */
  rationale: string;
}

export const PARENT_BRAND_MAP: readonly ParentBrandPair[] = [
  {
    parentName: 'פט ויני עזריאלי בע"מ',
    parentAliases: [
      "פט ויני עזריאלי בעמ",
      "פאט ויני עזריאלי בע\"מ",
      "פאט ויני עזריאלי בעמ",
      "פט ויני עזריאלי",
      "פאט ויני עזריאלי",
    ],
    operatingFranchiseeId: "ab020323-fefe-4543-9a69-16d14dd54b99",
    operatingFranchiseeName: "נתנזון עזריאלי חיפה",
    requiredOperatingKeywords: ["נתנזון בורגר", "Natanzon Burger"],
    // BLOCKING — only the Latin brand marker "VINNI". Earlier this list
    // held "ויני חיפה", which silently killed the override on EVERY
    // Mishloha invoice to this entity: the recipient header is
    // 'לכבוד: "פאט ויני חיפה(פט ויני עזריאלי בע"מ)"' and contains
    // "ויני חיפה" even on pure-Natanzon invoices (May 2026: invoice
    // 162041 — all line items נתנזון בורגר — routed to Pat Vini and
    // overwrote Vini's own 160782). "VINNI" appears only where the Vini
    // brand actually operates: Mishloha Vini line items ("VINNI ויני
    // חיפה _ הזמנות"), mixed invoices (10075), and HAAT red reports for
    // business 8093 — never in the לכבוד recipient block.
    blockingContentKeywords: ["VINNI"],
    rationale:
      'Mishlocha invoice 157159 (2026-04-30): legal entity Pat Vini Azrieli ' +
      'but every line item references נתנזון בורגר חיפה. Override fires ' +
      'only when a נתנזון בורגר / Natanzon Burger marker appears in the ' +
      'content AND no "VINNI" brand marker is present. Reut 2026-05-10 ' +
      'incident: HAAT/Mishlocha/Wolt documents that legitimately belong ' +
      'to Pat Vini Azrieli were being kidnapped to Natanzon by the older ' +
      'content-blind rule. Reut 2026-06-11 incident: pure-Natanzon Mishloha ' +
      'invoices were blocked by the over-broad "ויני חיפה" keyword and ' +
      'overwrote Pat Vini documents instead of routing to Natanzon.',
  },
];

/**
 * Shared-legal-entity disambiguation by client-assigned customer number.
 *
 * Some clients bill several franchisees that share ONE legal entity and ח.פ
 * (e.g. HAAT bills both "פט ויני עזריאלי חיפה" and "נתנזון עזריאלי חיפה"
 * under ח.פ 516161361). On those invoices the "לכבוד" recipient, the ח.פ,
 * and even the issuing ezcount account are identical — name-based matching
 * and the PARENT_BRAND_MAP keyword gate CANNOT tell them apart (the HAAT
 * commission invoice carries no "Natanzon Burger" marker). The only reliable
 * discriminator is the client's own per-restaurant customer number, printed
 * on every invoice as "מס. לקוח" (distinct from the 9-digit "מס. חברה לקוח"
 * legal-entity number, which is shared).
 *
 * Keyed by parserCode (uppercase) → customer number → operating franchisee.
 * Keep explicit; add a row only from a verified invoice (see the audit query
 * in memory:gotcha-haat-shared-entity-overwrites). Confirmed 2026-07-06 from
 * HAAT invoices months 3–6: Vini=107127, Natanzon=107143 (stable).
 */
export const CLIENT_CUSTOMER_NUMBER_MAP: Readonly<
  Record<string, Readonly<Record<string, { franchiseeId: string; franchiseeName: string }>>>
> = {
  HAAT: {
    "107127": {
      franchiseeId: "0e2a027a-18bb-4274-af4e-be451799a29b",
      franchiseeName: "פט ויני עזריאלי חיפה",
    },
    "107143": {
      franchiseeId: "ab020323-fefe-4543-9a69-16d14dd54b99",
      franchiseeName: "נתנזון עזריאלי חיפה",
    },
  },
};

/**
 * Find the franchisee for a document by the client-assigned customer number
 * embedded in its raw text. Returns null when the parser has no customer-number
 * map or no known number appears in the text.
 *
 * ponytail: matches the number as a standalone digit run (not part of a longer
 * number). The mapped numbers are distinctive 6-digit codes; if a future
 * client ever prints an amount equal to one, tighten to require the adjacent
 * "מס. לקוח" label.
 */
export function findFranchiseeByCustomerNumber(
  parserCode: string | undefined | null,
  contentText: string | undefined | null,
): { franchiseeId: string; franchiseeName: string } | null {
  if (!parserCode || !contentText) return null;
  const byNumber = CLIENT_CUSTOMER_NUMBER_MAP[parserCode.toUpperCase()];
  if (!byNumber) return null;
  for (const [customerNo, target] of Object.entries(byNumber)) {
    const bounded = new RegExp(`(?<!\\d)${customerNo}(?!\\d)`);
    if (bounded.test(contentText)) return target;
  }
  return null;
}

/**
 * Look up the operating-brand pair for a candidate name.
 *
 * Match rules (in order of preference):
 * 1. Exact match (after trim).
 * 2. Forward containment with word boundaries — the candidate string contains
 *    the alias as a whole-token sequence (e.g., candidate
 *    `"פט ויני עזריאלי בע\"מ - חיפה"` contains alias `"פט ויני עזריאלי בע\"מ"`).
 *
 * Reverse containment (alias.includes(candidate)) is intentionally NOT
 * supported — it caused the 2026-05-10 Hatt/Vini misattribution incident,
 * where generic substrings like `"ויני עזריאלי"` or `"ויני"` falsely fired
 * the Pat-Vini-Azrieli → Netanzon override. To match a shorter form, add
 * it explicitly to `parentAliases`.
 *
 * Content gate (added 2026-05-10): when `contentText` is supplied, at
 * least one of the pair's `requiredOperatingKeywords` MUST appear in the
 * text and none of `blockingContentKeywords` may appear. Callers that
 * don't have line-item text yet may pass `undefined`, in which case the
 * gate is skipped — but those call sites are now considered legacy; new
 * code should always supply the rawText/lineItems.
 */
export function findOperatingBrand(
  candidateName: string | undefined | null,
  contentText?: string | null,
): ParentBrandPair | null {
  if (!candidateName) return null;
  const normalised = candidateName.trim();
  if (!normalised) return null;
  for (const pair of PARENT_BRAND_MAP) {
    const haystack = [pair.parentName, ...(pair.parentAliases ?? [])];
    if (!haystack.some((name) => matchesAlias(normalised, name))) continue;

    // Content gate — only enforced when the caller supplies content.
    if (contentText && contentText.length > 0) {
      if (!pair.requiredOperatingKeywords.some((kw) => contentText.includes(kw))) {
        // Operating-brand keyword absent → this document belongs to
        // the parent legal entity in its own name, not the operating
        // brand. Skip the override.
        return null;
      }
      if (
        pair.blockingContentKeywords?.some((kw) => contentText.includes(kw))
      ) {
        // A conflicting brand keyword is present → the document is
        // mixed (or belongs to the parent) and the override would
        // misattribute it. Skip; caller will fall through to fuzzy
        // matching.
        return null;
      }
    }
    return pair;
  }
  return null;
}

/**
 * Whole-token forward containment. Returns true when `candidate` either
 * equals `alias` exactly or contains `alias` as a contiguous run of tokens
 * (i.e., bordered by whitespace, punctuation, or string edges) — never via
 * sub-word match.
 */
function matchesAlias(candidate: string, alias: string): boolean {
  if (candidate === alias) return true;
  if (candidate.length <= alias.length) return false;
  // Build a word-boundary check: alias must be flanked by non-word chars
  // (whitespace, punctuation) or string edges. Hebrew letters are word chars
  // for these purposes — so "פטא" must not match alias "פט", but
  // "פט " or " פט" or "(פט)" must match.
  const idx = candidate.indexOf(alias);
  if (idx < 0) return false;
  const before = idx === 0 ? "" : candidate[idx - 1];
  const after =
    idx + alias.length >= candidate.length
      ? ""
      : candidate[idx + alias.length];
  return !isWordChar(before) && !isWordChar(after);
}

function isWordChar(ch: string): boolean {
  if (!ch) return false;
  // Word chars: Hebrew letters, Latin letters, digits, underscore.
  return /[\p{L}\p{N}_]/u.test(ch);
}
