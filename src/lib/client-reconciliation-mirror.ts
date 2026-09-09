/**
 * Which clients only ever produce ONE side of the reconciliation, and what
 * to show on the other.
 *
 * Reconciliation normally compares a client_report (what the client says it
 * paid) against a tabit_report (what the POS says was sold). Some clients
 * structurally produce only one of the two, so the comparison has nothing to
 * do — but the row still has to carry a number, read as "תקין", and reach
 * the export. Production, all periods 03/2026–08/2026:
 *
 *   GIFTCARD / LATABLE / LATABLEMARK →  62 / 69 / 7 tabit rows,  0 client rows
 *   HEVER                            →   0 tabit rows,          81 client rows
 *
 * The rule used to be copy-pasted at four call sites and had already drifted:
 * three hard-coded "GIFTCARD" while the fourth carried the full three-member
 * set, so LATABLE exported fine but showed as `missing_client` on screen.
 * HEVER was in none of them, which is why Reut hand-approved it for all
 * 6–7 franchisees every single month (2026-09-09). One function now, so the
 * next client added here is added once.
 */

/** Tabit is the only ledger — no client invoice cycle exists. */
export const TABIT_ONLY_CLIENTS: ReadonlySet<string> = new Set([
  "GIFTCARD", // prepaid card sales, recorded through the POS only
  "LATABLE", // La Table loyalty meals
  "LATABLEMARK", // La Table marketing meals
]);

/**
 * The client's own report is the only ledger — these never appear as a Tabit
 * column. HEVER settles by bank transfer against a monthly file; there is no
 * POS line for it and there never will be.
 */
export const CLIENT_ONLY_CLIENTS: ReadonlySet<string> = new Set(["HEVER"]);

export interface MirroredAmounts {
  /** Amount to display / export in the "סכום לקוח" column. */
  clientAmount: number | null;
  /** Amount to display in the "סכום טאביט" column. */
  tabitAmount: number | null;
  /**
   * True when the row needs no human comparison: either both sides agree
   * within the threshold, or this client only has one side by design.
   */
  autoOk: boolean;
}

/** NIS. Same value the by-franchisee endpoint and the export path use. */
export const RECONCILIATION_THRESHOLD = 30;

/**
 * Resolve what the two columns should show for one (client, period) pair.
 *
 * Mirroring only ever FILLS IN a missing side — a real amount is never
 * overwritten, so a client that unexpectedly starts producing both reports
 * is compared normally instead of silently auto-approving.
 */
export function mirrorAmounts(
  clientCode: string | null | undefined,
  clientAmount: number | null,
  tabitAmount: number | null,
): MirroredAmounts {
  if (clientAmount !== null && tabitAmount !== null) {
    return {
      clientAmount,
      tabitAmount,
      autoOk: Math.abs(clientAmount - tabitAmount) <= RECONCILIATION_THRESHOLD,
    };
  }

  const code = clientCode ?? "";

  if (TABIT_ONLY_CLIENTS.has(code) && tabitAmount !== null) {
    return { clientAmount: tabitAmount, tabitAmount, autoOk: true };
  }

  if (CLIENT_ONLY_CLIENTS.has(code) && clientAmount !== null) {
    return { clientAmount, tabitAmount: clientAmount, autoOk: true };
  }

  return { clientAmount, tabitAmount, autoOk: false };
}
