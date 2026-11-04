/** Pure value formatting for H-Connect rows. All API values are strings. */

/** Round to cents, symmetric around zero (credit rows are negative). Never returns -0. */
export function roundCents(n: number): number {
  const r = (Math.sign(n) * Math.round(Math.abs(n) * 100)) / 100;
  return r === 0 ? 0 : r;
}

/** 5000 → "5000.00". Decimal point is mandatory for the API. */
export function apiMoney(n: number): string {
  return roundCents(n).toFixed(2);
}

/** 1 → "1.000". */
export function apiQuantity(n: number): string {
  return n.toFixed(3);
}

/**
 * imovein unit price after the Excel's "אחוז הנחה לפריט" (15.2543 / 19.2543, the VAT-share
 * trick): Discountprc is decimal 2.2 and rejects 4 decimals, so the discount is folded into
 * the price (ruling R21, Reut 01/11/2026). Rounded once, to agorot, like Hashavshevet rounds the
 * Excel line (quantity is always 1): 3 decimals would round twice (301.6947 → 301.695 → 301.70).
 */
export function apiNetPrice(price: number, discountPct: number): string {
  return (price * (1 - discountPct / 100)).toFixed(2);
}

/** YYYY-MM-DD of the month's last day (month is 1-12), from local date parts: never toISOString. */
export function lastDayOfMonth(year: number, month: number): string {
  const day = new Date(year, month, 0).getDate();
  return `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
}

/** "2026-10-31" → "31/10/2026". String-only: never goes through Date (no UTC shift). */
export function apiDate(ymd: string): string {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(ymd);
  if (!m) throw new Error(`apiDate expects YYYY-MM-DD, got "${ymd}"`);
  return `${m[3]}/${m[2]}/${m[1]}`;
}

/** Excel document-type numbering → H-Connect DocumentID. 11 = invoice (verify on first temp send, spec §13). */
export const EXCEL_TO_API_DOCUMENT_ID: Readonly<Record<number, string>> = { 11: "1" };

/** null = no API equivalent (unsupported for sending). */
export function apiDocumentId(excelType: number): string | null {
  return EXCEL_TO_API_DOCUMENT_ID[excelType] ?? null;
}

/**
 * Placeholder, pending Reut's sales TransType code (spec §13 #3). Replace it before activating
 * journal-entry sends: nothing has replaced it yet.
 */
export const JOURNAL_TRANS_TYPE = "00";

/** Expense movein entries (commission charged to the restaurant): Reut's own expense file uses "הוצ". */
export const EXPENSE_JOURNAL_TRANS_TYPE = "הוצ"; // ponytail: confirm on the first temporary send

/** Fixed sender prefix of the movein Reference (controller ruling: never a per-send value). */
export const REFERENCE_PREFIX = "LT";

/**
 * Stable numeric reference (≤9 digits) for a row: FNV-1a 32-bit over the UTF-8 bytes of
 * sendPrefix + rowKey, mod 10^9. ponytail: not collision-free (32-bit hash); the row lock, not this value, guards duplicates.
 */
export function internalReference(sendPrefix: string, rowKey: string): string {
  let h = 0x811c9dc5;
  for (const byte of new TextEncoder().encode(sendPrefix + rowKey)) {
    h ^= byte;
    h = Math.imul(h, 0x01000193) >>> 0;
  }
  return String(h % 1_000_000_000);
}
