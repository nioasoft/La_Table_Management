import type { ImportantDateType, DurationUnit } from "@/db/schema";
import { formatDateAsLocal } from "@/lib/date-utils";

/**
 * Calculate end date from start date and duration in months
 */
export function calculateEndDate(startDate: string, durationMonths: number): string {
  const date = new Date(startDate);
  date.setMonth(date.getMonth() + durationMonths);
  return formatDateAsLocal(date);
}

/**
 * Calculate reminder date from end date and months before
 */
export function calculateReminderDate(endDate: string, monthsBefore: number): string {
  const date = new Date(endDate);
  date.setMonth(date.getMonth() - monthsBefore);
  return formatDateAsLocal(date);
}

/**
 * Convert display unit and value to total months
 */
export function toMonths(value: number, unit: DurationUnit): number {
  return unit === "years" ? value * 12 : value;
}

/**
 * Convert months to display value and unit
 */
export function fromMonths(months: number): { value: number; unit: DurationUnit } {
  if (months % 12 === 0 && months >= 12) {
    return { value: months / 12, unit: "years" };
  }
  return { value: months, unit: "months" };
}

/**
 * Get reminder urgency level based on dates
 */
export function getReminderUrgency(
  endDate: string,
  reminderDate: string
): "expired" | "urgent" | "warning" | "none" {
  const today = new Date();
  const end = new Date(endDate);
  const reminder = new Date(reminderDate);
  const sevenDaysFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);

  // End date has passed
  if (end < today) {
    return "expired";
  }

  // Reminder date has passed (end date approaching)
  if (reminder <= today) {
    return "urgent";
  }

  // Within 7 days of reminder date
  if (reminder <= sevenDaysFromNow) {
    return "warning";
  }

  return "none";
}

/**
 * Date type labels in Hebrew
 */
export const DATE_TYPE_LABELS: Record<ImportantDateType, string> = {
  franchise_agreement: "הסכם זיכיון",
  rental_contract: "חוזה שכירות",
  lease_option: "אופציית שכירות",
  custom: "מותאם אישית",
};

/**
 * Duration unit labels in Hebrew
 */
export const DURATION_UNIT_LABELS: Record<DurationUnit, string> = {
  months: "חודשים",
  years: "שנים",
};
