/**
 * Settlement Periods Calculator
 *
 * Calculates automatic settlement periods based on the calendar and supplier billing frequencies.
 * Periods are:
 * - Monthly: 1st of every month (for suppliers like מיטלנד, אברהמי)
 * - Quarterly: 1/1, 1/4, 1/7, 1/10 (most suppliers)
 * - Semi-annual: 1/1, 1/7 (suppliers like מחלבות גד)
 * - Annual: 1/1 (suppliers like טמפו, תנובה, לאומי קארד)
 *
 * Some suppliers have a non-calendar fiscal year (e.g., Leumi Card: April-March).
 * The `fiscalYearStartMonth` parameter (1-12) controls the fiscal year start for annual periods.
 */

import type { SettlementPeriodType } from "@/db/schema";

export interface SettlementPeriodInfo {
  type: SettlementPeriodType;
  name: string;
  nameHe: string;
  startDate: Date;
  endDate: Date;
  dueDate: Date; // When reports should be submitted
  key: string; // Unique identifier like "2025-Q4", "2025-01", "2025-H2"
}

// Hebrew month names
const HEBREW_MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר"
];

/**
 * Get the current open periods based on today's date.
 * Returns all periods that should be processed now (reports due).
 */
export function getOpenPeriods(referenceDate: Date = new Date()): SettlementPeriodInfo[] {
  const periods: SettlementPeriodInfo[] = [];

  // Get all period types that are due now
  periods.push(...getMonthlyPeriods(referenceDate, 1)); // Last month
  periods.push(...getQuarterlyPeriods(referenceDate, 1)); // Last quarter if due
  periods.push(...getSemiAnnualPeriods(referenceDate, 1)); // Last half if due
  periods.push(...getAnnualPeriods(referenceDate, 1)); // Last year if due

  return periods;
}

/**
 * Get monthly periods. Called on the 1st of every month.
 * Returns the previous month's period.
 */
export function getMonthlyPeriods(referenceDate: Date = new Date(), count: number = 3): SettlementPeriodInfo[] {
  const periods: SettlementPeriodInfo[] = [];
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();

  for (let i = 1; i <= count; i++) {
    const periodMonth = month - i;
    const periodYear = periodMonth < 0 ? year - 1 : year;
    const adjustedMonth = periodMonth < 0 ? 12 + periodMonth : periodMonth;

    const startDate = new Date(periodYear, adjustedMonth, 1);
    const endDate = new Date(periodYear, adjustedMonth + 1, 0); // Last day of month
    const dueDate = new Date(periodYear, adjustedMonth + 1, 15); // 15th of next month

    periods.push({
      type: "monthly",
      name: `${HEBREW_MONTHS[adjustedMonth]} ${periodYear}`,
      nameHe: `${HEBREW_MONTHS[adjustedMonth]} ${periodYear}`,
      startDate,
      endDate,
      dueDate,
      key: `${periodYear}-${String(adjustedMonth + 1).padStart(2, '0')}`,
    });
  }

  return periods;
}

/**
 * Get quarterly periods.
 * Q1: Jan-Mar (due April 1)
 * Q2: Apr-Jun (due July 1)
 * Q3: Jul-Sep (due October 1)
 * Q4: Oct-Dec (due January 1)
 */
export function getQuarterlyPeriods(referenceDate: Date = new Date(), count: number = 2): SettlementPeriodInfo[] {
  const periods: SettlementPeriodInfo[] = [];
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();

  // Calculate current quarter (0-3)
  const currentQuarter = Math.floor(month / 3);

  for (let i = 1; i <= count; i++) {
    let quarter = currentQuarter - i;
    let periodYear = year;

    while (quarter < 0) {
      quarter += 4;
      periodYear--;
    }

    const quarterStartMonth = quarter * 3;
    const startDate = new Date(periodYear, quarterStartMonth, 1);
    const endDate = new Date(periodYear, quarterStartMonth + 3, 0);
    const dueDate = new Date(periodYear, quarterStartMonth + 3, 15);

    const quarterName = `Q${quarter + 1}`;
    const quarterNameHe = `רבעון ${quarter + 1}`;

    periods.push({
      type: "quarterly",
      name: `${quarterName} ${periodYear}`,
      nameHe: `${quarterNameHe} ${periodYear}`,
      startDate,
      endDate,
      dueDate,
      key: `${periodYear}-${quarterName}`,
    });
  }

  return periods;
}

/**
 * Get semi-annual periods.
 * H1: Jan-Jun (due July 1)
 * H2: Jul-Dec (due January 1)
 */
export function getSemiAnnualPeriods(referenceDate: Date = new Date(), count: number = 2): SettlementPeriodInfo[] {
  const periods: SettlementPeriodInfo[] = [];
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();

  // Current half (0 or 1)
  const currentHalf = month < 6 ? 0 : 1;

  for (let i = 1; i <= count; i++) {
    let half = currentHalf - i;
    let periodYear = year;

    while (half < 0) {
      half += 2;
      periodYear--;
    }

    const halfStartMonth = half * 6;
    const startDate = new Date(periodYear, halfStartMonth, 1);
    const endDate = new Date(periodYear, halfStartMonth + 6, 0);
    const dueDate = new Date(periodYear, halfStartMonth + 6, 15);

    const halfName = `H${half + 1}`;
    const halfNameHe = half === 0 ? "מחצית ראשונה" : "מחצית שנייה";

    periods.push({
      type: "semi_annual",
      name: `${halfName} ${periodYear}`,
      nameHe: `${halfNameHe} ${periodYear}`,
      startDate,
      endDate,
      dueDate,
      key: `${periodYear}-${halfName}`,
    });
  }

  return periods;
}

/**
 * Get annual periods.
 * Full year (due January 1 of next year)
 * @param fiscalYearStartMonth - 1-12, month the fiscal year starts (1=January, default)
 */
export function getAnnualPeriods(
  referenceDate: Date = new Date(),
  count: number = 2,
  fiscalYearStartMonth: number = 1
): SettlementPeriodInfo[] {
  const periods: SettlementPeriodInfo[] = [];
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth(); // 0-indexed
  const fyStartMonth0 = fiscalYearStartMonth - 1; // Convert to 0-indexed

  if (fiscalYearStartMonth > 1) {
    // Custom fiscal year (e.g., April-March for fiscalYearStartMonth=4)
    // Determine the current fiscal year start
    let currentFYStartYear = year;
    if (month < fyStartMonth0) {
      currentFYStartYear = year - 1;
    }

    for (let i = 1; i <= count; i++) {
      const fyStartYear = currentFYStartYear - i;
      const fyEndYear = fyStartYear + 1;
      const startDate = new Date(fyStartYear, fyStartMonth0, 1);
      const endDate = new Date(fyEndYear, fyStartMonth0, 0); // Last day of month before start
      const dueDate = new Date(fyEndYear, fyStartMonth0, 31); // 31 days into next FY

      periods.push({
        type: "annual",
        name: `FY ${fyStartYear}/${String(fyEndYear).slice(2)}`,
        nameHe: `${fyStartYear}/${String(fyEndYear).slice(2)}`,
        startDate,
        endDate,
        dueDate,
        key: `${fyStartYear}/${String(fyEndYear).slice(2)}`,
      });
    }
  } else {
    // Standard calendar year (January-December)
    for (let i = 1; i <= count; i++) {
      const periodYear = year - i;
      const startDate = new Date(periodYear, 0, 1);
      const endDate = new Date(periodYear, 11, 31);
      const dueDate = new Date(periodYear + 1, 0, 31); // January 31 of next year

      periods.push({
        type: "annual",
        name: `FY ${periodYear}`,
        nameHe: `שנת ${periodYear}`,
        startDate,
        endDate,
        dueDate,
        key: `${periodYear}`,
      });
    }
  }

  return periods;
}

/**
 * Check if a period is currently due (should be processed).
 * A period is due if the reference date is after the period end date
 * and before the due date + 30 days grace period.
 */
export function isPeriodDue(period: SettlementPeriodInfo, referenceDate: Date = new Date()): boolean {
  const periodEnd = period.endDate.getTime();
  const gracePeriodEnd = new Date(period.dueDate);
  gracePeriodEnd.setDate(gracePeriodEnd.getDate() + 30);

  return referenceDate.getTime() > periodEnd && referenceDate.getTime() <= gracePeriodEnd.getTime();
}

/**
 * Get period info by key (e.g., "2025-Q4", "2025-01", "2025-H2", "2025", "2025/26")
 * @param fiscalYearStartMonth - Required for custom fiscal year keys like "2025/26"
 */
export function getPeriodByKey(key: string, fiscalYearStartMonth: number = 1): SettlementPeriodInfo | null {
  // Parse key format
  if (key.includes("/")) {
    // Custom fiscal year annual: "2025/26"
    const [startYearStr, endYearSuffix] = key.split("/");
    const startYear = parseInt(startYearStr);
    if (isNaN(startYear)) return null;

    const fyStartMonth0 = fiscalYearStartMonth - 1; // Convert to 0-indexed
    const endYear = startYear + 1;
    const startDate = new Date(startYear, fyStartMonth0, 1);
    const endDate = new Date(endYear, fyStartMonth0, 0); // Last day of month before FY start
    const dueDate = new Date(endYear, fyStartMonth0, 31);

    return {
      type: "annual",
      name: `FY ${startYear}/${endYearSuffix}`,
      nameHe: `${startYear}/${endYearSuffix}`,
      startDate,
      endDate,
      dueDate,
      key,
    };
  } else if (key.includes("-Q")) {
    // Quarterly: "2025-Q4"
    const [yearStr, quarterStr] = key.split("-");
    const year = parseInt(yearStr);
    const quarter = parseInt(quarterStr.replace("Q", "")) - 1;
    const quarterStartMonth = quarter * 3;

    return {
      type: "quarterly",
      name: `${quarterStr} ${year}`,
      nameHe: `רבעון ${quarter + 1} ${year}`,
      startDate: new Date(year, quarterStartMonth, 1),
      endDate: new Date(year, quarterStartMonth + 3, 0),
      dueDate: new Date(year, quarterStartMonth + 3, 15),
      key,
    };
  } else if (key.includes("-H")) {
    // Semi-annual: "2025-H2"
    const [yearStr, halfStr] = key.split("-");
    const year = parseInt(yearStr);
    const half = parseInt(halfStr.replace("H", "")) - 1;
    const halfStartMonth = half * 6;
    const halfNameHe = half === 0 ? "מחצית ראשונה" : "מחצית שנייה";

    return {
      type: "semi_annual",
      name: `${halfStr} ${year}`,
      nameHe: `${halfNameHe} ${year}`,
      startDate: new Date(year, halfStartMonth, 1),
      endDate: new Date(year, halfStartMonth + 6, 0),
      dueDate: new Date(year, halfStartMonth + 6, 15),
      key,
    };
  } else if (key.includes("-")) {
    // Monthly: "2025-01"
    const [yearStr, monthStr] = key.split("-");
    const year = parseInt(yearStr);
    const month = parseInt(monthStr) - 1;

    return {
      type: "monthly",
      name: `${HEBREW_MONTHS[month]} ${year}`,
      nameHe: `${HEBREW_MONTHS[month]} ${year}`,
      startDate: new Date(year, month, 1),
      endDate: new Date(year, month + 1, 0),
      dueDate: new Date(year, month + 1, 15),
      key,
    };
  } else {
    // Annual: "2025"
    const year = parseInt(key);
    if (isNaN(year)) return null;

    return {
      type: "annual",
      name: `FY ${year}`,
      nameHe: `שנת ${year}`,
      startDate: new Date(year, 0, 1),
      endDate: new Date(year, 11, 31),
      dueDate: new Date(year + 1, 0, 31),
      key,
    };
  }
}

/**
 * Get all periods for a specific frequency
 * @param fiscalYearStartMonth - 1-12, only affects annual periods (default: 1=January)
 */
export function getPeriodsForFrequency(
  frequency: SettlementPeriodType,
  referenceDate: Date = new Date(),
  count: number = 4,
  fiscalYearStartMonth: number = 1
): SettlementPeriodInfo[] {
  switch (frequency) {
    case "monthly":
      return getMonthlyPeriods(referenceDate, count);
    case "quarterly":
      return getQuarterlyPeriods(referenceDate, count);
    case "semi_annual":
      return getSemiAnnualPeriods(referenceDate, count);
    case "annual":
      return getAnnualPeriods(referenceDate, count, fiscalYearStartMonth);
    default:
      return [];
  }
}

/**
 * Get all periods for a specific year based on frequency.
 * Returns periods in chronological order (oldest first).
 * @param fiscalYearStartMonth - 1-12, only affects annual periods (default: 1=January)
 */
export function getPeriodsForYear(
  frequency: SettlementPeriodType,
  year: number,
  fiscalYearStartMonth: number = 1
): SettlementPeriodInfo[] {
  const periods: SettlementPeriodInfo[] = [];

  switch (frequency) {
    case "monthly":
      // 12 monthly periods
      for (let month = 0; month < 12; month++) {
        const startDate = new Date(year, month, 1);
        const endDate = new Date(year, month + 1, 0);
        const dueDate = new Date(year, month + 1, 15);

        periods.push({
          type: "monthly",
          name: `${HEBREW_MONTHS[month]} ${year}`,
          nameHe: `${HEBREW_MONTHS[month]} ${year}`,
          startDate,
          endDate,
          dueDate,
          key: `${year}-${String(month + 1).padStart(2, '0')}`,
        });
      }
      break;

    case "quarterly":
      // 4 quarterly periods
      for (let quarter = 0; quarter < 4; quarter++) {
        const quarterStartMonth = quarter * 3;
        const startDate = new Date(year, quarterStartMonth, 1);
        const endDate = new Date(year, quarterStartMonth + 3, 0);
        const dueDate = new Date(year, quarterStartMonth + 3, 15);
        const quarterName = `Q${quarter + 1}`;
        const quarterNameHe = `רבעון ${quarter + 1}`;

        periods.push({
          type: "quarterly",
          name: `${quarterName} ${year}`,
          nameHe: `${quarterNameHe} ${year}`,
          startDate,
          endDate,
          dueDate,
          key: `${year}-${quarterName}`,
        });
      }
      break;

    case "semi_annual":
      // 2 semi-annual periods
      for (let half = 0; half < 2; half++) {
        const halfStartMonth = half * 6;
        const startDate = new Date(year, halfStartMonth, 1);
        const endDate = new Date(year, halfStartMonth + 6, 0);
        const dueDate = new Date(year, halfStartMonth + 6, 15);
        const halfName = `H${half + 1}`;
        const halfNameHe = half === 0 ? "מחצית ראשונה" : "מחצית שנייה";

        periods.push({
          type: "semi_annual",
          name: `${halfName} ${year}`,
          nameHe: `${halfNameHe} ${year}`,
          startDate,
          endDate,
          dueDate,
          key: `${year}-${halfName}`,
        });
      }
      break;

    case "annual":
      if (fiscalYearStartMonth > 1) {
        // Custom fiscal year: the period that ends in `year`
        // e.g., for fiscalYearStartMonth=4 and year=2026, returns 2025/26 (Apr 2025 - Mar 2026)
        const fyStartMonth0 = fiscalYearStartMonth - 1;
        const startYear = year - 1;
        const startDate = new Date(startYear, fyStartMonth0, 1);
        const endDate = new Date(year, fyStartMonth0, 0);
        const dueDate = new Date(year, fyStartMonth0, 31);
        const endYearSuffix = String(year).slice(2);

        periods.push({
          type: "annual",
          name: `FY ${startYear}/${endYearSuffix}`,
          nameHe: `${startYear}/${endYearSuffix}`,
          startDate,
          endDate,
          dueDate,
          key: `${startYear}/${endYearSuffix}`,
        });
      } else {
        // Standard calendar year
        periods.push({
          type: "annual",
          name: `FY ${year}`,
          nameHe: `שנת ${year}`,
          startDate: new Date(year, 0, 1),
          endDate: new Date(year, 11, 31),
          dueDate: new Date(year + 1, 0, 31),
          key: `${year}`,
        });
      }
      break;
  }

  return periods;
}

/**
 * Get available periods for a supplier (current year + last 8 periods).
 * Returns periods in reverse chronological order (newest first).
 * @param fiscalYearStartMonth - 1-12, only affects annual periods (default: 1=January)
 */
export function getAvailablePeriodsForSupplier(
  frequency: SettlementPeriodType,
  referenceDate: Date = new Date(),
  fiscalYearStartMonth: number = 1
): SettlementPeriodInfo[] {
  const currentYear = referenceDate.getFullYear();

  // Get periods for current year and previous years
  // For custom fiscal years (e.g., Apr-Mar), we need an extra year back
  // since getPeriodsForYear(2025, 4) returns 2025/26 (ending Mar 2026)
  const yearsBack = fiscalYearStartMonth > 1 ? 3 : 2;
  const allYearPeriods: SettlementPeriodInfo[] = [];
  for (let i = 0; i < yearsBack; i++) {
    allYearPeriods.push(...getPeriodsForYear(frequency, currentYear - i, fiscalYearStartMonth));
  }

  // Combine and sort by end date descending
  const allPeriods = allYearPeriods.sort(
    (a, b) => b.endDate.getTime() - a.endDate.getTime()
  );

  // Filter to only include periods that have ended (we can't upload reports for future periods)
  const endedPeriods = allPeriods.filter(
    (p) => p.endDate.getTime() < referenceDate.getTime()
  );

  // Return up to 8 periods
  return endedPeriods.slice(0, 8);
}

/**
 * Format date range for display
 * Handles both Date objects and ISO date strings
 */
export function formatPeriodRange(period: { startDate: Date | string; endDate: Date | string }): string {
  const startDate = typeof period.startDate === 'string' ? new Date(period.startDate) : period.startDate;
  const endDate = typeof period.endDate === 'string' ? new Date(period.endDate) : period.endDate;

  const start = startDate.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });
  const end = endDate.toLocaleDateString("he-IL", { day: "numeric", month: "short", year: "numeric" });
  return `${start} - ${end}`;
}

/**
 * Get the period type display name in Hebrew
 */
export function getPeriodTypeLabel(type: SettlementPeriodType): string {
  const labels: Record<SettlementPeriodType, string> = {
    monthly: "חודשי",
    quarterly: "רבעוני",
    semi_annual: "חצי שנתי",
    annual: "שנתי",
  };
  return labels[type] || type;
}
