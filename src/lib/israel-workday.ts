import { HebrewCalendar, flags } from "@hebcal/core";

function isYomTovInIsrael(year: number, month1to12: number, day: number): boolean {
  const d = new Date(Date.UTC(year, month1to12 - 1, day));
  const events = HebrewCalendar.getHolidaysOnDate(d, true) || [];
  return events.some((e) => (e.getFlags() & flags.CHAG) !== 0);
}

export function isIsraelWorkday(date: Date): boolean {
  const dow = date.getDay();
  if (dow === 5 || dow === 6) return false;
  return !isYomTovInIsrael(date.getFullYear(), date.getMonth() + 1, date.getDate());
}

export function isFirstWorkdayOfMonth(now: Date): boolean {
  if (!isIsraelWorkday(now)) return false;
  const year = now.getFullYear();
  const month = now.getMonth();
  const today = now.getDate();
  for (let day = 1; day < today; day++) {
    if (isIsraelWorkday(new Date(year, month, day))) return false;
  }
  return true;
}
