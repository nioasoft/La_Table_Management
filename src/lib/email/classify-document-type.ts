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
];

/**
 * Detect document type from email subject.
 *
 * Override patterns are checked first so franchisee→client invoices
 * with subjects containing "חשבונית מס" are correctly classified as
 * client_report, not commission_invoice.
 */
export function detectDocumentType(subject: string): ClientDocumentType {
  for (const pattern of CLIENT_REPORT_OVERRIDE_PATTERNS) {
    if (pattern.test(subject)) {
      return "client_report";
    }
  }
  const lower = subject.toLowerCase();
  for (const keyword of INVOICE_SUBJECT_KEYWORDS) {
    if (lower.includes(keyword.toLowerCase())) {
      return "commission_invoice";
    }
  }
  return "client_report";
}
