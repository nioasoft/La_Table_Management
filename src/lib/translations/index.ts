/**
 * Translation Helper Utilities for La Table Management System
 *
 * This module provides helper functions for accessing Hebrew translations
 * with type-safe path lookups and interpolation support.
 */

import { he, type HebrewTranslations } from "./he";
import {
  emailTranslations,
  type EmailTranslations,
  interpolateEmail,
  emailSubjects,
  emailSignOff,
} from "./emails";

// Re-export the translations object and type
export { he, type HebrewTranslations };

// Re-export email translations
export {
  emailTranslations,
  type EmailTranslations,
  interpolateEmail,
  emailSubjects,
  emailSignOff,
};

/**
 * Type-safe path accessor for nested translation objects.
 * Generates all possible dot-notation paths for the translations object.
 */
type PathImpl<T, K extends keyof T> = K extends string
  ? T[K] extends Record<string, unknown>
    ? T[K] extends readonly unknown[]
      ? K
      : `${K}.${PathImpl<T[K], keyof T[K]>}` | K
    : K
  : never;

type Path<T> = PathImpl<T, keyof T>;

/**
 * Extracts the type at a given dot-notation path in an object.
 */
type PathValue<T, P extends string> = P extends `${infer K}.${infer Rest}`
  ? K extends keyof T
    ? PathValue<T[K], Rest>
    : never
  : P extends keyof T
    ? T[P]
    : never;

/**
 * Translation path type for the Hebrew translations object.
 */
export type TranslationPath = Path<HebrewTranslations>;

/**
 * Parameters for interpolation in translation strings.
 * Extracts variable names from strings like "Hello {name}!" -> { name: string | number }
 */
type InterpolationParams<T extends string> =
  T extends `${string}{${infer Param}}${infer Rest}`
    ? { [K in Param | keyof InterpolationParams<Rest>]: string | number }
    : Record<string, never>;

/**
 * Gets a nested value from an object using a dot-notation path.
 *
 * @param obj - The object to traverse
 * @param path - Dot-notation path (e.g., "auth.signIn.title")
 * @returns The value at the path or undefined if not found
 */
function getNestedValue<T extends Record<string, unknown>>(
  obj: T,
  path: string
): unknown {
  return path.split(".").reduce<unknown>((current, key) => {
    if (current && typeof current === "object" && key in current) {
      return (current as Record<string, unknown>)[key];
    }
    return undefined;
  }, obj);
}

/**
 * Interpolates variables in a translation string.
 * Replaces {variable} patterns with corresponding values from params.
 *
 * @param text - The translation string with {variable} placeholders
 * @param params - Object containing variable values
 * @returns The interpolated string
 *
 * @example
 * interpolate("שלום {name}!", { name: "יוסי" }) // "שלום יוסי!"
 * interpolate("צפה בכל {count} התזכורות", { count: 5 }) // "צפה בכל 5 התזכורות"
 */
function interpolate(
  text: string,
  params: Record<string, string | number>
): string {
  return text.replace(/\{(\w+)\}/g, (match, key) => {
    if (key in params) {
      return String(params[key]);
    }
    // Return original placeholder if param not found
    return match;
  });
}

/**
 * Gets a translation string by its dot-notation path.
 * Supports variable interpolation for dynamic values.
 *
 * @param path - Dot-notation path to the translation (e.g., "auth.signIn.title")
 * @param params - Optional parameters for variable interpolation
 * @returns The translated string, or the path itself if not found
 *
 * @example
 * // Simple usage
 * t("common.save") // "שמור"
 * t("auth.signIn.title") // "התחברות"
 *
 * // With interpolation
 * t("dashboard.reminders.viewAllReminders", { count: 5 }) // "צפה בכל 5 התזכורות"
 *
 * // Nested path
 * t("admin.users.dialogs.reject.title") // "דחה הרשמת משתמש"
 */
export function t(
  path: string,
  params?: Record<string, string | number>
): string {
  const value = getNestedValue(he, path);

  if (typeof value === "string") {
    return params ? interpolate(value, params) : value;
  }

  // Return path as fallback for development/debugging
  console.warn(`Translation not found: ${path}`);
  return path;
}

/**
 * Type-safe version of the translation function.
 * Use this when you want TypeScript to validate translation paths at compile time.
 *
 * @param path - Type-safe dot-notation path to the translation
 * @param params - Optional parameters for variable interpolation
 * @returns The translated string
 *
 * @example
 * // TypeScript will catch typos in the path
 * ts("auth.signIn.title") // ✓ Valid
 * ts("auth.sinIn.title")  // ✗ TypeScript error
 */
export function ts<P extends TranslationPath>(
  path: P,
  params?: PathValue<HebrewTranslations, P> extends string
    ? InterpolationParams<PathValue<HebrewTranslations, P>>
    : never
): string {
  return t(path, params as Record<string, string | number>);
}

/**
 * Helper to get an entire section of translations.
 * Useful when you need multiple translations from the same section.
 *
 * @param section - The top-level section key
 * @returns The translations section object
 *
 * @example
 * const auth = getSection("auth");
 * auth.signIn.title // "התחברות"
 * auth.signUp.title // "יצירת חשבון"
 */
export function getSection<K extends keyof HebrewTranslations>(
  section: K
): HebrewTranslations[K] {
  return he[section];
}

/**
 * Formats a date according to Hebrew locale (he-IL).
 *
 * @param date - The date to format
 * @param options - Intl.DateTimeFormat options
 * @returns Formatted date string in Hebrew
 *
 * @example
 * formatDate(new Date()) // "9 בינואר 2026"
 * formatDate(new Date(), { dateStyle: "short" }) // "9.1.2026"
 */
export function formatDate(
  date: Date | string | number,
  options: Intl.DateTimeFormatOptions = { dateStyle: "long" }
): string {
  const d = date instanceof Date ? date : new Date(date);
  return new Intl.DateTimeFormat("he-IL", options).format(d);
}

/**
 * Formats a number according to Hebrew locale (he-IL).
 *
 * @param value - The number to format
 * @param options - Intl.NumberFormat options
 * @returns Formatted number string
 *
 * @example
 * formatNumber(1234.56) // "1,234.56"
 * formatNumber(1234.56, { style: "currency", currency: "ILS" }) // "₪ 1,234.56"
 */
export function formatNumber(
  value: number,
  options: Intl.NumberFormatOptions = {}
): string {
  return new Intl.NumberFormat("he-IL", options).format(value);
}

/**
 * Formats a currency value in Israeli Shekels (ILS).
 *
 * @param value - The amount to format
 * @returns Formatted currency string
 *
 * @example
 * formatCurrency(1234.56) // "₪ 1,234.56"
 */
export function formatCurrency(value: number): string {
  return formatNumber(value, {
    style: "currency",
    currency: "ILS",
  });
}

/**
 * Formats a percentage value.
 *
 * @param value - The percentage value (e.g., 0.25 for 25%)
 * @param decimals - Number of decimal places (default: 2)
 * @returns Formatted percentage string
 *
 * @example
 * formatPercent(0.25) // "25%"
 * formatPercent(0.256, 1) // "25.6%"
 */
export function formatPercent(value: number, decimals: number = 2): string {
  return formatNumber(value, {
    style: "percent",
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/**
 * Gets a relative time string in Hebrew (e.g., "לפני 3 ימים").
 *
 * @param date - The date to compare against now
 * @returns Relative time string in Hebrew
 *
 * @example
 * formatRelativeTime(new Date(Date.now() - 86400000)) // "לפני יום"
 */
export function formatRelativeTime(date: Date | string | number): string {
  const d = date instanceof Date ? date : new Date(date);
  const now = new Date();
  const diffMs = d.getTime() - now.getTime();
  const diffDays = Math.round(diffMs / (1000 * 60 * 60 * 24));

  const rtf = new Intl.RelativeTimeFormat("he-IL", { numeric: "auto" });

  if (Math.abs(diffDays) < 1) {
    const diffHours = Math.round(diffMs / (1000 * 60 * 60));
    if (Math.abs(diffHours) < 1) {
      const diffMinutes = Math.round(diffMs / (1000 * 60));
      return rtf.format(diffMinutes, "minute");
    }
    return rtf.format(diffHours, "hour");
  } else if (Math.abs(diffDays) < 30) {
    return rtf.format(diffDays, "day");
  } else if (Math.abs(diffDays) < 365) {
    const diffMonths = Math.round(diffDays / 30);
    return rtf.format(diffMonths, "month");
  } else {
    const diffYears = Math.round(diffDays / 365);
    return rtf.format(diffYears, "year");
  }
}
