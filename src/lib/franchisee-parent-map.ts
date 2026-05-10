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
    rationale:
      "Mishlocha invoice 157159 (2026-04-30): legal entity Pat Vini Azrieli " +
      "but every line item references נתנזון בורגר חיפה. Same pattern observed " +
      "for Wolt May 2026 emails — File A (Wolt commission invoice) was " +
      "addressed to Pat Vini Azrieli while File B (ezcount sales invoice) was " +
      "issued by Natanzon. Route both files to the operating brand.",
  },
];

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
 */
export function findOperatingBrand(
  candidateName: string | undefined | null,
): ParentBrandPair | null {
  if (!candidateName) return null;
  const normalised = candidateName.trim();
  if (!normalised) return null;
  for (const pair of PARENT_BRAND_MAP) {
    const haystack = [pair.parentName, ...(pair.parentAliases ?? [])];
    if (haystack.some((name) => matchesAlias(normalised, name))) {
      return pair;
    }
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
