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
 * Performs a normalised contains-or-equals check against parentName + aliases.
 * Returns null if no parent mapping applies.
 */
export function findOperatingBrand(
  candidateName: string | undefined | null,
): ParentBrandPair | null {
  if (!candidateName) return null;
  const normalised = candidateName.trim();
  if (!normalised) return null;
  for (const pair of PARENT_BRAND_MAP) {
    const haystack = [pair.parentName, ...(pair.parentAliases ?? [])];
    if (
      haystack.some(
        (name) =>
          normalised === name ||
          normalised.includes(name) ||
          name.includes(normalised),
      )
    ) {
      return pair;
    }
  }
  return null;
}
