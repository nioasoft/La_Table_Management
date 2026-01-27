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
