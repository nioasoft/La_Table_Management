import { describe, expect, it } from "vitest";

import {
  deriveBrandExportGate,
  hashavshevetExportUrl,
} from "@/components/franchisee-billing-export";

describe("franchisee billing export links", () => {
  it("builds the status URL for the selected local billing period", () => {
    expect(hashavshevetExportUrl({ year: 2026, month: 7 })).toBe(
      "/api/franchisee-billing/hashavshevet-export?year=2026&month=7&mode=status",
    );
  });

  it.each(["royalty", "marketing"] as const)(
    "builds a separate %s file URL for each brand",
    (itemType) => {
      const url = hashavshevetExportUrl(
        { year: 2026, month: 7 },
        "brand-1",
        itemType,
      );
      const parsed = new URL(url, "http://localhost");

      expect(parsed.pathname).toBe(
        "/api/franchisee-billing/hashavshevet-export",
      );
      expect(Object.fromEntries(parsed.searchParams)).toEqual({
        year: "2026",
        month: "7",
        brandId: "brand-1",
        itemType,
      });
    },
  );

  it("derives the 7/8 label, exact missing names and disabled state", () => {
    expect(deriveBrandExportGate({
      brandId: "brand-1",
      brandCode: "MINNA_TOMEI",
      brandName: "מינה טומאיי",
      readyCount: 7,
      totalActive: 8,
      canExport: false,
      missing: [{
        franchiseeId: "franchisee-8",
        franchiseeName: "מינה טומאיי קריון",
      }],
    })).toEqual({
      coverageLabel: "7/8",
      missingNames: ["מינה טומאיי קריון"],
      exportDisabled: true,
    });
  });
});
