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
  // EasyCount/ezcount-relayed invoices ("EasyCount Invoice for HAAT",
  // "ezcount Invoice ..."). These are invoices the FRANCHISEE issued to the
  // platform (e.g. פאט ויני עזריאלי → Haat Delivery, invoice 10078) — i.e.
  // revenue evidence, the document Reut reconciles as the HAAT "report".
  // They were previously classified commission_invoice (keyword "easycount
  // invoice"), which parked them in the commission_invoice slot where HAAT's
  // real "חשבונית מרכזת SI..." overwrote them a day later — the May 2026
  // "המערכת קלטה פירוט ולא דוח" incident (Reut 2026-06-11).
  /easycount\s+invoice|ezcount\s+invoice/i,
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
 * Issuer tokens that identify a COMMISSION invoice issued BY a delivery
 * platform (the "מאת <X>" side of an ezcount/EasyCount tax-invoice subject).
 * When a "חשבונית מס NNNN מאת <X>" subject names one of these as the issuer,
 * it is the platform charging us commission — keep it in commission_invoice.
 *
 * Anything ELSE after "מאת" is a franchisee issuing a sales invoice TO the
 * platform (revenue evidence) — see isFranchiseeIssuedInvoice below.
 *
 * Keep this list aligned with the active platform clients. A franchisee name
 * must never appear here (none currently overlap: ויני / נתנזון / קינג קונג /
 * מינה / קסטרא / סידיוס / ...).
 */
export const COMMISSION_ISSUER_TOKENS: readonly string[] = [
  "משלוחה",
  "דיב אנד רד", // Mishloha's legal entity — "דיב אנד רד פרוג'קטס בע\"מ"
  "wolt",
  "וולט",
  "haat",
  "האט",
  "האאט",
  "pluxee",
  "פלאקסי",
  "cibus",
  "סיבוס",
  "תן ביס",
  "10bis",
];

/**
 * A franchisee-issued ezcount/EasyCount sales invoice arrives as a DIRECT
 * ezcount email (noreply@ezcount.co.il) with a "[מקור]" body and a plain
 * subject "חשבונית מס NNNN מאת <franchisee> בע\"מ" — no "[העתק]" prefix, so
 * the copy override (CLIENT_REPORT_OVERRIDE_PATTERNS[0]) does not fire and
 * the "חשבונית מס" keyword would otherwise mark it commission_invoice.
 *
 * It is revenue evidence (the franchisee billing the platform) — the "report"
 * Reut reconciles — so it belongs in client_report. We tell it apart from a
 * platform-issued commission invoice ("... מאת משלוחה / מאת Wolt") by the
 * issuer named after "מאת" (see COMMISSION_ISSUER_TOKENS).
 *
 * Real incident 2026-06-11 (Reut): Mishloha's direct ezcount invoice 10076
 * (פאט ויני עזריאלי → משלוחה, May 2026, ח.פ 516161361) was typed
 * commission_invoice, collided with Mishloha's real commission invoice
 * 160782 in the same (franchisee, period, type) slot, and the overwrite
 * guard parked it in the review queue — Vini Azrieli's May Mishloha report
 * never ingested. The [העתק] HAAT variant was already handled (2026-05-05);
 * this covers the un-forwarded [מקור] direct-ezcount form.
 */
export function isFranchiseeIssuedInvoice(subject: string): boolean {
  if (!subject || !subject.includes("חשבונית")) return false;
  const marker = "מאת";
  const idx = subject.indexOf(marker);
  if (idx === -1) return false;
  const issuer = subject.slice(idx + marker.length).trim().toLowerCase();
  if (!issuer) return false;
  return !COMMISSION_ISSUER_TOKENS.some((t) => issuer.includes(t.toLowerCase()));
}

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
  // Wolt campaign-terms-update announcement (no data to extract).
  // Added 2026-06-07 — "ביקשתם, קיבלתם! עדכנו את תנאי הקמפיין" slipped past
  // the skip list and tripped the daily failure digest. Pinned to the
  // distinctive campaign-terms phrase to avoid matching real report subjects.
  /עדכנו\s*את\s*תנאי\s*הקמפיין/,
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

/**
 * HAAT's own monthly summary PDF ("HAAT Delivery | הדוח החודשי שלך עבור
 * MM/YYYY מוכן" — the red-branded "דווח האאט"). Per Reut (2026-06-11,
 * "הדוח האדום לא רלוונטי לי לכלום") this document has no business use:
 * the reconciled HAAT "report" is the franchisee-issued EasyCount invoice.
 *
 * Worse, it actively corrupted data: businesses 8093 (VINNI) and 8095
 * (Natanzon Burger) share one legal entity, so both red reports resolved
 * to פט ויני עזריאלי and the second overwrote the first in the
 * client_report slot. Dropping it on arrival (like the Cibus daily
 * snapshot) removes the corruption vector entirely. The original PDF is
 * still recorded in gmail_sync_log diagnostics if it's ever needed.
 */
const HAAT_MONTHLY_REPORT_PATTERN = /הדוח\s*החודשי\s*שלך\s*עבור/;

export function isHaatMonthlyReport(
  clientCode: string | null | undefined,
  subject: string | null | undefined,
): boolean {
  if (!clientCode || clientCode.toUpperCase() !== "HAAT") return false;
  if (!subject) return false;
  return HAAT_MONTHLY_REPORT_PATTERN.test(subject);
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
  // A "חשבונית מס NNNN מאת <franchisee>" issued BY a franchisee (not a
  // platform) is revenue evidence — must be checked BEFORE the commission
  // keyword below, which would otherwise swallow it on "חשבונית מס".
  if (isFranchiseeIssuedInvoice(subject)) {
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
