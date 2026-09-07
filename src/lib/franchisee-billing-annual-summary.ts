import type {
  FranchiseeBillingAnnualRow,
  FranchiseeBillingAnnualType,
} from "@/schemas/franchisee-billing-annual";

/**
 * One row as the annual query returns it: a franchisee joined to at most one
 * billing row per month. Everything past the identity is null for a branch
 * that has no billing row in the selected year.
 */
export interface AnnualQueryRow {
  readonly franchiseeId: string;
  readonly franchiseeName: string;
  readonly brandName: string;
  readonly periodMonth: number | null;
  readonly netBase: string | null;
  readonly royalty: string | null;
  readonly marketing: string | null;
  readonly discountValue: string | null;
}

export interface AnnualBrandSection {
  readonly brandName: string;
  readonly rows: readonly FranchiseeBillingAnnualRow[];
  /** Same shape as a branch row, so both outputs render it identically. */
  readonly subtotal: FranchiseeBillingAnnualRow;
}

export interface AnnualGrouping {
  readonly brands: readonly AnnualBrandSection[];
  readonly grandTotal: FranchiseeBillingAnnualRow;
}

const MONTHS_IN_YEAR = 12;

const VALUE_COLUMN: Record<
  FranchiseeBillingAnnualType,
  "netBase" | "royalty" | "marketing" | "discountValue"
> = {
  turnover: "netBase",
  royalties: "royalty",
  marketing: "marketing",
  discounts: "discountValue",
};

interface Accumulator {
  readonly franchiseeId: string;
  readonly franchiseeName: string;
  readonly brandName: string;
  readonly months: (string | null)[];
  turnover: number;
}

function emptyMonths(): (string | null)[] {
  return Array.from({ length: MONTHS_IN_YEAR }, () => null);
}

/** Sums the filled cells; an all-empty row totals zero and averages to null. */
function closeRow(
  identity: Pick<
    FranchiseeBillingAnnualRow,
    "franchiseeId" | "franchiseeName" | "brandName"
  >,
  months: readonly (string | null)[],
  turnoverTotal: number | null,
): FranchiseeBillingAnnualRow {
  const filled = months.filter((value): value is string => value !== null);
  const total = filled.reduce((carry, value) => carry + Number(value), 0);
  return {
    ...identity,
    months: [...months],
    total: String(total),
    average: filled.length === 0 ? null : String(total / filled.length),
    ratePercent:
      turnoverTotal === null || turnoverTotal <= 0
        ? null
        : String((total / turnoverTotal) * 100),
    turnoverTotal: turnoverTotal === null ? null : String(turnoverTotal),
  };
}

/**
 * Turns the flat franchisee×month join into one row per branch with twelve
 * month cells. A month with no billing row stays null rather than zero — an
 * empty cell and a real ₪0 month are different facts.
 */
export function pivotAnnualRows(
  raw: readonly AnnualQueryRow[],
  reportType: FranchiseeBillingAnnualType,
): FranchiseeBillingAnnualRow[] {
  const column = VALUE_COLUMN[reportType];
  const byFranchisee = new Map<string, Accumulator>();

  for (const row of raw) {
    let accumulator = byFranchisee.get(row.franchiseeId);
    if (!accumulator) {
      accumulator = {
        franchiseeId: row.franchiseeId,
        franchiseeName: row.franchiseeName,
        brandName: row.brandName,
        months: emptyMonths(),
        turnover: 0,
      };
      byFranchisee.set(row.franchiseeId, accumulator);
    }
    if (row.periodMonth === null) continue;
    const value = row[column];
    if (value !== null) accumulator.months[row.periodMonth - 1] = value;
    accumulator.turnover += Number(row.netBase ?? 0);
  }

  return [...byFranchisee.values()].map((accumulator) =>
    closeRow(
      {
        franchiseeId: accumulator.franchiseeId,
        franchiseeName: accumulator.franchiseeName,
        brandName: accumulator.brandName,
      },
      accumulator.months,
      // The percentage is the royalty grid's column alone; carrying the
      // turnover lets the brand and group totals recompute it on the sums
      // instead of averaging percentages, which would be wrong.
      reportType === "royalties" ? accumulator.turnover : null,
    ),
  );
}

function totalsRow(
  identity: Pick<
    FranchiseeBillingAnnualRow,
    "franchiseeId" | "franchiseeName" | "brandName"
  >,
  rows: readonly FranchiseeBillingAnnualRow[],
): FranchiseeBillingAnnualRow {
  const months = emptyMonths();
  for (let month = 0; month < MONTHS_IN_YEAR; month += 1) {
    const filled = rows
      .map((row) => row.months[month])
      .filter((value): value is string => value !== null);
    if (filled.length === 0) continue;
    months[month] = String(
      filled.reduce((carry, value) => carry + Number(value), 0),
    );
  }
  const turnovers = rows
    .map((row) => row.turnoverTotal)
    .filter((value): value is string => value !== null);
  const turnoverTotal =
    turnovers.length === 0
      ? null
      : turnovers.reduce((carry, value) => carry + Number(value), 0);
  return closeRow(identity, months, turnoverTotal);
}

/**
 * Reut's coloured lines: a subtotal under every brand and one group total at
 * the bottom, in the order the query already sorted the branches.
 */
export function groupAnnualRows(
  rows: readonly FranchiseeBillingAnnualRow[],
): AnnualGrouping {
  const byBrand = new Map<string, FranchiseeBillingAnnualRow[]>();
  for (const row of rows) {
    const existing = byBrand.get(row.brandName);
    if (existing) existing.push(row);
    else byBrand.set(row.brandName, [row]);
  }

  const brands = [...byBrand.entries()].map(([brandName, brandRows]) => ({
    brandName,
    rows: brandRows,
    subtotal: totalsRow(
      { franchiseeId: "", franchiseeName: `סה״כ ${brandName}`, brandName },
      brandRows,
    ),
  }));

  return {
    brands,
    grandTotal: totalsRow(
      { franchiseeId: "", franchiseeName: "סה״כ קבוצתי", brandName: "" },
      rows,
    ),
  };
}

/**
 * A year where every branch is listed but no month is filled is not worth
 * exporting — the export guard and the button's disabled state share this so
 * they cannot disagree.
 */
export function hasAnnualData(
  rows: readonly FranchiseeBillingAnnualRow[],
): boolean {
  return rows.some((row) => row.months.some((value) => value !== null));
}
