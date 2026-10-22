/**
 * Which supplier files a VAT-flag change in the supplier card should re-run.
 *
 * A period is closed once a live session for exactly that period is completed
 * or has its file approved — Reut already signed it off, so a card edit must
 * not reopen it. Every other period (in progress, rejected file, no session
 * yet) is open.
 */
const CLOSED_STATUSES = new Set(["completed", "file_approved"]);

export interface PeriodFile {
  periodStartDate: string;
  periodEndDate: string;
}

export interface PeriodSession extends PeriodFile {
  status: string;
}

const key = (p: PeriodFile) => `${p.periodStartDate}|${p.periodEndDate}`;

/** `sessions` must be the supplier's non-archived sessions. */
export function filesInOpenPeriods<T extends PeriodFile>(
  files: T[],
  sessions: PeriodSession[]
): T[] {
  const closed = new Set(
    sessions.filter((s) => CLOSED_STATUSES.has(s.status)).map(key)
  );
  return files.filter((f) => !closed.has(key(f)));
}
