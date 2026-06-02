/**
 * Inbound email subject → documentType classifier.
 *
 * Shared between the live webhook (`/api/clients/email-inbound/route.ts`)
 * and the offline reprocess script (`scripts/reprocess-inbound-email.ts`)
 * so both honour the same rules.
 */

export type ClientDocumentType = "client_report" | "commission_invoice";

/** Subject keywords that flag a commission invoice (HAAT-issued, Wolt-issued, Tnbis tax invoice, etc.). */
export const INVOICE_SUBJECT_KEYWORDS: readonly string[] = [
  "חשבונית מס",
  "חשבונית עמלה",
  "חשבונית מס/קבלה",
  // HAAT centralised invoice — "FW: חשבונית מרכזת ..."
  "חשבונית מרכזת",
  "tax invoice",
  "commission invoice",
  // EasyCount-issued invoices: "FW: EasyCount Invoice for HAAT" / "ezcount Invoice"
  "easycount invoice",
  "ezcount invoice",
  // Cibus/Plaxie monthly commission invoice — "FW: החשבונית החודשית מפלאקסי ישראל"
  "החשבונית החודשית",
];

/**
 * Patterns that LOOK like commission invoices because of the
 * "חשבונית מס" / "tax invoice" keywords, but are actually a franchisee-
 * issued sales invoice forwarded to us (e.g. HAAT EasyCount copies).
 *
 * Confirmed by Reut 2026-05-05 for HAAT subjects of the form:
 *   "FW: [העתק] חשבונית מס 10049 מאת קינג קונג חורב בע\"מ"
 *   "FW: [העתק] חשבונית מס 10072 מאת קסטרא טומאיי בע\"מ ..."
 *
 * The "[העתק]" + "מאת" combo means "[copy] ... from <franchisee>".
 * The franchisee is the issuer, the client is the recipient — so this
 * is revenue evidence and belongs in the client_report bucket.
 */
export const CLIENT_REPORT_OVERRIDE_PATTERNS: readonly RegExp[] = [
  /\[העתק\][\s\S]*חשבונית[\s\S]*מאת/,
  // Cibus/Pluxee authoritative month-end report ("ריכוז חיוב חודשי - <זכיין>").
  // Its body carries the instruction "יש לשלוח חשבונית מס לפלאקסי על סכום כולל
  // מע\"מ ..." — which the body fallback (detectDocumentType, below) would
  // otherwise read as a commission_invoice keyword, forcing the attachment
  // path and failing the (attachment-less) email. The subject is unambiguous,
  // so pin it to client_report. Added 2026-06-02 after the body fallback (from
  // 2026-05-10) silently zeroed the entire May 2026 Cibus dataset: every
  // month-end report failed to ingest while daily snapshots overwrote the
  // franchisee+month docs with zero-movement figures.
  /ריכוז\s*חיוב\s*חודשי/,
];

/**
 * Subject keywords that flag a franchisee-issued income invoice (חשבונית
 * הכנסה). These are revenue evidence, not commission charges, so they
 * belong in the client_report bucket. Checked BEFORE the commission
 * keywords because "חשבונית הכנסה מס" subjects also match the looser
 * "חשבונית מס" commission keyword if it ever appears as a substring.
 *
 * Added 2026-05-10 after Reut reported a Hatt-Netanzon income invoice
 * was misclassified as a Vini-Azrieli commission invoice.
 */
export const INCOME_INVOICE_KEYWORDS: readonly string[] = [
  "חשבונית הכנסה",
  "income invoice",
];

/**
 * Subject patterns for promotional / non-data emails that should be auto-
 * skipped (not processed, not failed). Anything matching here is treated
 * as a "drop on the floor silently" — the sync log still records the
 * email for auditability but with status=completed and no errors.
 *
 * Added 2026-05-17 after Reut reported daily failure emails dominated by
 * Wolt Benefits announcements, Cibus "הסכם התקשרות" contracts, and other
 * marketing notifications that have no data to extract.
 *
 * IMPORTANT: keep patterns conservative — false positives here drop real
 * data silently. Prefer literal product/announcement names over generic
 * promotional words ("מבצע", "הטבה") which could appear in legitimate
 * report subjects.
 */
export const PROMOTIONAL_SUBJECT_PATTERNS: readonly RegExp[] = [
  /Wolt\s*Benefits/i,
  /תגידו\s*שלום\s*למוצר/,
  /הסכם\s*התקשרות/,
  // Wolt account/system notifications + marketing (no data to extract).
  // Added 2026-06-02 — these were the bulk of the daily failure digest.
  /תוקף\s*הגישה/, //  "...בע\"מ - תוקף הגישה הנדרשת ..."
  /verify\s*your\s*email/i,
  /ניוזז/, // Wolt newsletter ("מאי ניוזזז! הרבה דברים קורים ב-Wolt")
  /הצטרפו\s*לקמפיין/, // Wolt campaign invites ("הצטרפו לקמפיין המונדיאל ...")
  // Cibus/Pluxee account notification (no data).
  /שינוי\s*סיסמה/,
];

/**
 * Pluxee/Cibus started sending a DAILY "Pluxee דוח" snapshot (single-day
 * billing period) on 2026-05-03, IN ADDITION to the authoritative month-end
 * "ריכוז חיוב חודשי - <זכיין>" report. The daily snapshot overwrites the
 * franchisee+month client_document with single-day (usually zero-movement)
 * figures, corrupting the monthly total — it zeroed the entire May 2026 Cibus
 * dataset. Per Reut (2026-06-02) the daily snapshots have no business use;
 * only the month-end report is reconciled. So we drop the daily snapshots on
 * arrival. The month-end report is matched by its own subject
 * ("ריכוז חיוב חודשי ...") and is unaffected.
 *
 * Matched conservatively: the exact daily subject is literally "Pluxee דוח"
 * with no franchisee suffix (the month-end report always carries " - <זכיין>").
 */
const CIBUS_DAILY_REPORT_PATTERN = /^pluxee\s+דוח$/;

export function isCibusDailyReport(
  clientCode: string | null | undefined,
  subject: string | null | undefined,
): boolean {
  if (!clientCode || clientCode.toUpperCase() !== "CIBUS") return false;
  if (!subject) return false;
  return CIBUS_DAILY_REPORT_PATTERN.test(subject.trim().toLowerCase());
}

export function isPromotionalSubject(
  subject: string | null | undefined,
): boolean {
  if (!subject) return false;
  return PROMOTIONAL_SUBJECT_PATTERNS.some((p) => p.test(subject));
}

/**
 * Detect document type from email subject (and optionally body content).
 *
 * Resolution order:
 *  1. Subject override patterns (e.g. `[העתק] ... חשבונית ... מאת`).
 *  2. Subject income-invoice keywords (חשבונית הכנסה / income invoice).
 *  3. Subject commission-invoice keywords (חשבונית מס, tax invoice, ...).
 *  4. Body fallback (when provided): scan first 2000 chars for the same
 *     two keyword families. Income wins over commission on tie.
 *  5. Default `client_report`.
 *
 * The body fallback handles ambiguous subjects ("FW: invoice") where the
 * actual document type is only stated in the email body. It is OFF-PATH
 * for confident-subject cases — we never let the body override an
 * unambiguous subject keyword, otherwise we re-introduce the same false
 * positives the override patterns were added to suppress.
 */
export function detectDocumentType(
  subject: string,
  body?: string,
): ClientDocumentType {
  for (const pattern of CLIENT_REPORT_OVERRIDE_PATTERNS) {
    if (pattern.test(subject)) {
      return "client_report";
    }
  }
  const subjectLower = subject.toLowerCase();
  if (containsAny(subjectLower, INCOME_INVOICE_KEYWORDS)) {
    return "client_report";
  }
  if (containsAny(subjectLower, INVOICE_SUBJECT_KEYWORDS)) {
    return "commission_invoice";
  }
  if (body) {
    const bodyLower = body.slice(0, 2000).toLowerCase();
    if (containsAny(bodyLower, INCOME_INVOICE_KEYWORDS)) {
      return "client_report";
    }
    if (containsAny(bodyLower, INVOICE_SUBJECT_KEYWORDS)) {
      return "commission_invoice";
    }
  }
  return "client_report";
}

function containsAny(haystackLower: string, keywords: readonly string[]): boolean {
  return keywords.some((kw) => haystackLower.includes(kw.toLowerCase()));
}
