import * as XLSX from "xlsx";

/** A settlement period as local YYYY-MM-DD strings (never toISOString). */
export interface PeriodRange {
  start: string;
  end: string;
}

export type SheetPick = { sheetName: string; noteHe?: string } | { errorHe: string };

// "Q3", "Q3 2026", "Q3-2026", "רבעון 3 2026". The lookbehind keeps words like
// "SQ1" out; a bare quarter without a year matches any year.
const QUARTER_LABEL =
  /(?<![A-Za-z])Q\s?([1-4])(?!\d)(?:\D{0,3}(20\d{2}))?|רבעון\s*([1-4])(?:\D{0,3}(20\d{2}))?/gi;

interface QuarterLabel {
  quarter: number;
  year?: number;
}

function quarterLabels(text: string): QuarterLabel[] {
  return [...text.matchAll(QUARTER_LABEL)].map((m) => {
    const year = m[2] ?? m[4];
    return { quarter: Number(m[1] ?? m[3]), year: year ? Number(year) : undefined };
  });
}

/** The quarter a period sits in, or null when it spans more than one. */
function periodQuarter(period: PeriodRange): { quarter: number; year: number } | null {
  const [startYear, startMonth] = period.start.split("-").map(Number);
  const [endYear, endMonth] = period.end.split("-").map(Number);
  const quarter = Math.ceil(startMonth / 3);
  return startYear === endYear && Math.ceil(endMonth / 3) === quarter
    ? { quarter, year: startYear }
    : null;
}

/** Sheet name plus its title rows — where suppliers write "מכירות Q3 2026". */
function sheetLabels(workbook: XLSX.WorkBook, name: string): QuarterLabel[] {
  const rows = XLSX.utils.sheet_to_json<unknown[]>(workbook.Sheets[name], { header: 1, defval: "" });
  return quarterLabels([name, ...rows.slice(0, 10).flat()].join(" "));
}

function ambiguous(names: string[], reasonHe: string): SheetPick {
  return {
    errorHe:
      `בקובץ יש ${names.length} גיליונות (${names.join(" / ")}) ולא ברור מאיזה לקלוט — ${reasonHe}. ` +
      "לא נקלט כלום. יש לוודא שזה הקובץ הנכון, או להשאיר בו רק את הגיליון של התקופה ולהעלות שוב.",
  };
}

/**
 * Which sheet of a generic-parser workbook holds the chosen period.
 * רסטרטו Q3-2026 sent last quarter's tab first and the Q3 tab second; the
 * configured sheet matched neither, the first tab was read and Q2's amounts
 * were billed as Q3. A multi-tab file is now resolved by the period labels on
 * its tabs, and when that is not conclusive the file is refused, not guessed.
 */
export function pickSheetForPeriod(
  workbook: XLSX.WorkBook,
  configured: string | undefined,
  period: PeriodRange | undefined
): SheetPick {
  const names = workbook.SheetNames;
  if (configured && names.includes(configured)) return { sheetName: configured };
  if (names.length <= 1) return { sheetName: names[0] };

  const named = configured ? names.filter((n) => n.includes(configured)) : [];
  const candidates = named.length > 0 ? named : names;
  const labeled = candidates
    .map((name) => ({ name, labels: sheetLabels(workbook, name) }))
    .filter((s) => s.labels.length > 0);

  if (labeled.length > 0) {
    const target = period ? periodQuarter(period) : null;
    if (!target) return ambiguous(names, "הגיליונות מסומנים לפי רבעון ולא נבחר רבעון אחד");
    const label = `Q${target.quarter} ${target.year}`;
    const matches = labeled.filter((s) =>
      s.labels.some((l) => l.quarter === target.quarter && (!l.year || l.year === target.year))
    );
    if (matches.length === 0) return ambiguous(names, `אף גיליון לא מסומן לתקופה שנבחרה (${label})`);
    if (matches.length > 1) return ambiguous(names, `כמה גיליונות מסומנים לתקופה שנבחרה (${label})`);
    const others = names.filter((n) => n !== matches[0].name);
    return {
      sheetName: matches[0].name,
      noteHe: `נקלט הגיליון "${matches[0].name}" לפי התקופה שנבחרה (${label}). גיליונות נוספים בקובץ שלא נקלטו: ${others.join(" / ")}.`,
    };
  }

  if (candidates.length === 1) return { sheetName: candidates[0] };
  // ponytail: unlabeled tabs with no configured sheet keep the legacy first-sheet read
  if (!configured) return { sheetName: names[0] };
  return ambiguous(names, `הגיליון שמוגדר לספק ("${configured}") לא נמצא`);
}
