/**
 * Converts discount percentage points to their shekel value for live preview.
 */
export function discountValueForPoints(
  netBase: string,
  discountRatePoints: number,
): number {
  return Number(netBase) * discountRatePoints / 100;
}
