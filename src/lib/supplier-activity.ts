/**
 * Does the supplier still owe a settlement report for a period that starts on
 * `periodStart` (YYYY-MM-DD)?
 *
 * Active → always. Inactive with an `inactiveFrom` date → only periods that
 * began before that date (the supplier still sold during them). Inactive with
 * no date, or a period we can't date → nothing is owed.
 */
export function supplierOwesPeriod(
  supplier: { isActive: boolean; inactiveFrom: string | null },
  periodStart: string | null
): boolean {
  if (supplier.isActive) return true;
  if (!supplier.inactiveFrom || !periodStart) return false;
  return periodStart < supplier.inactiveFrom;
}

/**
 * Server rule for saving a supplier: an inactive supplier must say since when
 * (Reut, 2026-10-12 — an empty date silently meant "owes nothing").
 * Returns a user-facing error, or null when valid.
 */
export function inactiveFromError(
  isActive: boolean,
  inactiveFrom: string | null | undefined
): string | null {
  if (inactiveFrom && !/^\d{4}-\d{2}-\d{2}$/.test(inactiveFrom)) {
    return "תאריך 'לא פעיל מתאריך' לא תקין";
  }
  if (!isActive && !inactiveFrom) {
    return "יש להזין ממתי הספק לא פעיל";
  }
  return null;
}
