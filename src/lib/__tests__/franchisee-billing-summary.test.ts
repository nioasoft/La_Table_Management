import { describe, expect, it } from "vitest";

import { summarizeReportRows } from "@/lib/franchisee-billing-summary";
import type { SummaryReportRow } from "@/schemas/franchisee-billing-reports";

function row(overrides: Partial<SummaryReportRow>): SummaryReportRow {
  return {
    franchiseeId: "f1",
    franchiseeName: "ויני יהוד",
    brandName: "ויני",
    grossBase: "1180",
    netBase: "1000",
    effectiveRate: "4.00",
    royalty: "40",
    marketing: "10",
    total: "59",
    status: "approved",
    ...overrides,
  };
}

describe("summarizeReportRows", () => {
  it("sums every column and weights the overall percent by the net base", () => {
    const totals = summarizeReportRows(
      [
        row({ franchiseeId: "f1" }),
        row({
          franchiseeId: "f2",
          grossBase: "2360",
          netBase: "2000",
          effectiveRate: "3.00",
          royalty: "60",
          marketing: "20",
          total: "94.4",
        }),
      ],
      "0.18",
    );

    expect(totals.grossBase).toBe(3540);
    expect(totals.netBase).toBe(3000);
    // 100 royalty over 3,000 net — not the average of 4% and 3%.
    expect(totals.overallRate).toBeCloseTo(3.3333, 3);
    expect(totals.royalty).toBe(100);
    expect(totals.marketing).toBe(30);
    expect(totals.royaltyWithVat).toBeCloseTo(118, 6);
    expect(totals.marketingWithVat).toBeCloseTo(35.4, 6);
    // The stored per-row לתשלום, not a recalculation.
    expect(totals.totalWithVat).toBeCloseTo(153.4, 6);
  });

  it("keeps a zero-net month at 0% instead of dividing by zero", () => {
    const totals = summarizeReportRows(
      [row({ grossBase: "0", netBase: "0", royalty: "0", marketing: "0", total: "0" })],
      null,
    );

    expect(totals.overallRate).toBe(0);
    expect(totals.totalWithVat).toBe(0);
  });
});
