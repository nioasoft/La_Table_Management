import { formatDateAsLocal } from "@/lib/date-utils";

/**
 * The last date a BKMV snapshot can honestly claim to cover.
 *
 * `uploaded_file.period_end_date` is the max *transaction* date found in the
 * file, not the reported period. Bookkeeping exports routinely carry documents
 * dated months into the future (post-dated cheques, forward-dated invoices,
 * typos), so a file uploaded on 07/05/2026 can land a period_end_date of
 * 29/12/2026 — and every consumer that reads it as "covers through December"
 * silently stops asking for the next quarter's file.
 *
 * Two guards:
 *   1. Cap at the upload date — a file cannot report a month that hasn't
 *      happened yet when it was produced.
 *   2. Count only fully-elapsed months — an export made mid-May holds complete
 *      data through 30/04, not through 07/05.
 *
 * @param periodEndDate - uploaded_file.period_end_date (YYYY-MM-DD)
 * @param uploadedAt - uploaded_file.created_at
 * @returns YYYY-MM-DD of the last fully-covered day, or null if undeterminable
 */
export function bkmvCoverageEnd(
  periodEndDate: string | null | undefined,
  uploadedAt: Date | string | null | undefined
): string | null {
  if (!periodEndDate) return null;

  const uploadedOn = toLocalDateString(uploadedAt);
  // Both are YYYY-MM-DD, so lexical comparison is chronological.
  const effective =
    uploadedOn && uploadedOn < periodEndDate ? uploadedOn : periodEndDate;

  const [year, month, day] = effective.split("-").map(Number);
  if (!year || !month || !day) return null;

  // new Date(y, m, 0) is the last day of month m (1-indexed).
  const lastDayOfMonth = new Date(year, month, 0).getDate();
  if (day === lastDayOfMonth) return effective;

  // Mid-month export: the current month is incomplete, so coverage stops at
  // the end of the previous month. new Date(y, m - 1, 0) rolls the year back
  // correctly for January.
  return formatDateAsLocal(new Date(year, month - 1, 0));
}

function toLocalDateString(value: Date | string | null | undefined): string | null {
  if (!value) return null;
  if (typeof value === "string") return value.slice(0, 10);
  return Number.isNaN(value.getTime()) ? null : formatDateAsLocal(value);
}
