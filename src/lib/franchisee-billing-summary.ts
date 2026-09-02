import type { SummaryReportRow } from "@/schemas/franchisee-billing-reports";

/** The totals block under Reut's monthly summary — one source for UI and Excel. */
export interface SummaryReportTotals {
  readonly grossBase: number;
  readonly netBase: number;
  /** Weighted percent actually billed: royalties as a share of the net base. */
  readonly overallRate: number;
  readonly royalty: number;
  readonly marketing: number;
  readonly royaltyWithVat: number;
  readonly marketingWithVat: number;
  /** Sum of the stored per-row לתשלום, not a recalculation. */
  readonly totalWithVat: number;
}

function sum(
  rows: readonly SummaryReportRow[],
  field: "grossBase" | "netBase" | "royalty" | "marketing" | "total",
): number {
  return rows.reduce((carry, row) => carry + Number(row[field]), 0);
}

export function summarizeReportRows(
  rows: readonly SummaryReportRow[],
  vatRate: string | null,
): SummaryReportTotals {
  const netBase = sum(rows, "netBase");
  const royalty = sum(rows, "royalty");
  const marketing = sum(rows, "marketing");
  // A month cannot be billed without a VAT rate, so null only happens on an
  // empty report — where every product of it is zero anyway.
  const vatFactor = 1 + Number(vatRate ?? 0);
  return {
    grossBase: sum(rows, "grossBase"),
    netBase,
    overallRate: netBase > 0 ? (royalty / netBase) * 100 : 0,
    royalty,
    marketing,
    royaltyWithVat: royalty * vatFactor,
    marketingWithVat: marketing * vatFactor,
    totalWithVat: sum(rows, "total"),
  };
}
