import { describe, expect, it } from "vitest";

import {
  buildFranchiseeBillingReportUrl,
  resolveFranchiseeBillingReportTab,
} from "@/lib/franchisee-billing-report-request";
import type { FranchiseeBillingReportType } from "@/schemas/franchisee-billing-reports";

const reportTypes = [
  "royalties",
  "turnover",
  "collection",
  "discounts",
] as const satisfies readonly FranchiseeBillingReportType[];

describe("franchisee billing report request wiring", () => {
  it.each(reportTypes)("maps the %s tab to its report type", (reportType) => {
    expect(resolveFranchiseeBillingReportTab(reportType)).toBe(reportType);
  });

  it("rejects an unknown tab value", () => {
    expect(resolveFranchiseeBillingReportTab("unknown")).toBeNull();
  });

  it.each(reportTypes)(
    "builds data parameters for the %s tab",
    (reportType) => {
      expect(
        buildFranchiseeBillingReportUrl({
          reportType,
          year: 2026,
          month: 6,
        }),
      ).toBe(
        `/api/reports/franchisee-billing?reportType=${reportType}&year=2026&month=6`,
      );
    },
  );

  it("uses the same selected report parameters for export", () => {
    expect(
      buildFranchiseeBillingReportUrl(
        { reportType: "collection", year: 2026, month: 6 },
        "export",
      ),
    ).toBe(
      "/api/reports/franchisee-billing/export?reportType=collection&year=2026&month=6",
    );
  });
});
