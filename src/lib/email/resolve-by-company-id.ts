/**
 * Resolve a franchisee from the ח.פ / ע.מ number printed on a document.
 *
 * WHY THIS EXISTS — ezcount, 2026-09-02.
 * Franchisee resolution had exactly one deterministic input (the customer
 * number, which only a few clients print) and otherwise depended on reading
 * a Hebrew name out of a PDF. Hebrew survives that trip badly: pdf-parse
 * emits it visually reversed on some layouts, ezcount started emitting the
 * customer-name block as UTF-8-through-cp1252 mojibake, and the name wraps
 * across a variable number of lines. Every one of those has cost a month of
 * documents at least once.
 *
 * The ח.פ does not have any of those problems. It is ASCII digits, it is
 * printed under the recipient block on every Israeli tax invoice, and
 * `franchisee.company_id` already holds it for 22 of the 23 active
 * franchisees. Matching on it is exact and immune to font, encoding and
 * text-direction changes — so it runs BEFORE any name-based logic.
 *
 * Deliberately conservative:
 *  - Only accepts when the document's 9-digit numbers resolve to exactly
 *    ONE franchisee. A multi-tenant document (several franchisees' ח.פ on
 *    one page) falls through to the existing logic rather than guessing.
 *  - The issuer's own ח.פ (משלוחה 514570290, HAAT 516136603 …) is not a
 *    franchisee, so it never matches and needs no special-casing.
 */

/** Israeli company / business numbers are exactly 9 digits. */
const COMPANY_ID_PATTERN = /(?<!\d)\d{9}(?!\d)/g;

export interface CompanyIdCandidate {
  id: string;
  name: string;
  companyId: string | null;
}

/**
 * Returns the single franchisee whose ח.פ appears in `text`, or null when
 * none or more than one does.
 */
export function resolveFranchiseeByCompanyId<T extends CompanyIdCandidate>(
  text: string,
  franchisees: readonly T[],
): T | null {
  if (!text) return null;

  const found = new Set(text.match(COMPANY_ID_PATTERN) ?? []);
  if (found.size === 0) return null;

  const matches = franchisees.filter(
    (f) => f.companyId && found.has(f.companyId.trim()),
  );

  // Zero matches → nothing to say. More than one distinct franchisee → the
  // document covers several of them; guessing is how documents end up in
  // the wrong slot, so leave it to the caller's other strategies.
  const distinct = new Map(matches.map((m) => [m.id, m]));
  if (distinct.size !== 1) return null;

  return [...distinct.values()][0];
}
