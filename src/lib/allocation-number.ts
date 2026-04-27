/**
 * Israeli tax allocation number (מספר הקצאה) — domain constants and helpers.
 *
 * Israeli law requires a 9-digit allocation number on every tax invoice over
 * a fixed threshold. The threshold is currently ₪10,000 and is scheduled to
 * drop to ₪5,000 — when it does, only `ALLOCATION_NUMBER_THRESHOLD` below
 * needs to change.
 */

/** Threshold above which an Israeli tax invoice must carry an allocation number. */
export const ALLOCATION_NUMBER_THRESHOLD = 10000;

/**
 * Returns true when an invoice of the given amount is legally required to
 * carry an allocation number but doesn't have one. Used to surface a
 * non-blocking warning to admins reviewing/uploading invoices.
 */
export function isAllocationNumberMissing(
  totalAmount: number | null | undefined,
  allocationNumber: string | null | undefined
): boolean {
  if (allocationNumber) return false;
  if (totalAmount == null) return false;
  return totalAmount > ALLOCATION_NUMBER_THRESHOLD;
}
