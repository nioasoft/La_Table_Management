/**
 * Date utility functions for consistent date handling across the application.
 * These functions help avoid timezone issues when converting dates to strings.
 */

/**
 * Format a Date object as a local date string (YYYY-MM-DD).
 * This avoids the timezone issue where toISOString() converts to UTC,
 * potentially shifting the date by a day for non-UTC timezones.
 *
 * Example:
 *   In Israel (UTC+2/+3), new Date(2025, 9, 1).toISOString() returns "2025-09-30T21:00:00.000Z"
 *   which when split becomes "2025-09-30" instead of "2025-10-01".
 *   This function returns "2025-10-01" correctly.
 *
 * @param date - The Date object to format
 * @returns A string in YYYY-MM-DD format using local timezone
 */
export function formatDateAsLocal(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

/**
 * Clamp a date input value to ensure validity.
 * - Truncates year to 4 digits if longer (prevents "20255" overflow)
 * - Clamps day to the maximum valid day for the given month/year (prevents Feb 30)
 *
 * @param value - A date string in YYYY-MM-DD format (from input[type="date"])
 * @returns The clamped date string, or the original value if empty or non-matching format
 */
export function clampDateValue(value: string): string {
  if (!value) return value;

  const match = value.match(/^(\d{4,})-(\d{2})-(\d{2})$/);
  if (!match) return value;

  const year = parseInt(match[1].slice(0, 4), 10);
  const month = parseInt(match[2], 10);
  let day = parseInt(match[3], 10);

  // new Date(year, month, 0) gives the last day of the given month
  const maxDay = new Date(year, month, 0).getDate();
  if (day > maxDay) day = maxDay;

  return `${String(year).padStart(4, '0')}-${String(month).padStart(2, '0')}-${String(day).padStart(2, '0')}`;
}
