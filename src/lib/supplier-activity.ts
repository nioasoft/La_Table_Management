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
