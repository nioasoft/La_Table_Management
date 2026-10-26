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
 * "אחוז הנחה לפריט" as the exact 4-decimal string ("15.2543"). Never round to 2 decimals:
 * the value is the VAT-share trick, and rounding it would shift the net amount (ruling R21).
 */
export function apiDiscountPct(n: number): string {
  return n.toFixed(4);
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

export const JOURNAL_TRANS_TYPE = "00"; // ponytail: Reut's sales code replaces this before go-live (task 14)

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
