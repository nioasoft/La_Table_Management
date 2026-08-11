/**
 * The window of days a report file actually covers.
 *
 * A client_document is keyed by (client, franchisee, month) — one row per
 * month. That holds while a platform bills a whole month at a time, which is
 * the norm. It broke in July 2026 when Wolt split קינג קונג מוצקין's month
 * into two payouts: the second file collided with the first and was parked,
 * leaving half a month stored as if it were the whole one.
 *
 * Telling "a second file for the same month" apart from "a re-delivery of the
 * same file" needs the coverage window, and the platforms put it in the file
 * name:
 *
 *   |_sales_report_semi_monthly_2026-07-01_2026-07-16.pdf   Wolt, first half
 *   |_sales_report_custom_2026-07-16_2026-08-01.pdf         Wolt, second half
 *   21657_20260701_20260731.pdf                             10bis, full month
 *
 * Dates are built as YYYY-MM-DD strings straight from the digits — never
 * through `Date`, whose UTC conversion shifts an Israeli date back a day.
 */

export interface CoveragePeriod {
  /** YYYY-MM-DD, inclusive. */
  start: string;
  /**
   * YYYY-MM-DD. Treated as EXCLUSIVE when it is the first of a month, because
   * that is how Wolt writes a period ending at month end ("..._2026-08-01"
   * for a window that stops on 31 July). Without this, July's second half and
   * August's first half would look like they overlap on 1 August.
   */
  end: string;
}

/** Two ISO date strings, adjacent in the name, separated by _ or -. */
const RANGE_RE =
  /(\d{4})-?(\d{2})-?(\d{2})[_-](\d{4})-?(\d{2})-?(\d{2})/;

function isValid(y: string, m: string, d: string): boolean {
  const month = parseInt(m, 10);
  const day = parseInt(d, 10);
  const year = parseInt(y, 10);
  return (
    year >= 2000 && year <= 2100 && month >= 1 && month <= 12 && day >= 1 && day <= 31
  );
}

/**
 * Read the coverage window out of a file name.
 *
 * Returns null when the name carries no range — most files. A null means
 * "unknown", never "full month": callers must not merge on a guess.
 */
export function extractCoveragePeriod(fileName: string): CoveragePeriod | null {
  const m = fileName.match(RANGE_RE);
  if (!m) return null;

  const [, y1, m1, d1, y2, m2, d2] = m;
  if (!isValid(y1, m1, d1) || !isValid(y2, m2, d2)) return null;

  const start = `${y1}-${m1}-${d1}`;
  const end = `${y2}-${m2}-${d2}`;
  if (start >= end) return null;

  return { start, end };
}

/**
 * Do two windows cover any of the same days?
 *
 * `end` is exclusive, so a window ending 2026-07-16 and one starting
 * 2026-07-16 are adjacent, not overlapping — which is exactly how Wolt writes
 * two halves of one month. Comparison is lexicographic, valid for
 * zero-padded YYYY-MM-DD.
 */
export function periodsOverlap(a: CoveragePeriod, b: CoveragePeriod): boolean {
  return a.start < b.end && b.start < a.end;
}
