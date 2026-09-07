import { describe, expect, it } from "vitest";

import { buildDiscountNoticePreview } from "@/app/api/franchisee-billing/notify-discount/preview";

const row = {
  id: "billing-1",
  franchiseeName: 'קינג קונג מוצקין בע"מ',
  owners: null,
  periodYear: 2026,
  periodMonth: 8,
  status: "approved",
  grossBase: "1077874.000000",
  netBase: "913452.542373",
  tierRate: "3.00",
  discountRatePoints: "1.00",
  effectiveRate: "2.00",
  royaltyFull: "27403.576271",
  discountValue: "9134.525424",
  royalty: "18269.050847",
} as const;

describe("buildDiscountNoticePreview", () => {
  it("renders the notice for the first recipient and names the rest", async () => {
    const preview = await buildDiscountNoticePreview(row, [
      { name: "ליאור", email: "liorfit1@gmail.com" },
      { name: "רביד", email: "ravidl2506@gmail.com" },
    ]);

    expect(preview.subject).toBe(
      'חיוב תמלוגים · קינג קונג מוצקין בע"מ · אוגוסט 2026',
    );
    expect(preview.shownFor).toBe("liorfit1@gmail.com");
    expect(preview.recipients).toEqual([
      "liorfit1@gmail.com",
      "ravidl2506@gmail.com",
    ]);
    // React's renderer splits interpolations with comment markers, so the
    // greeting is asserted by its parts rather than as one string.
    expect(preview.html).toContain("שלום ");
    expect(preview.html).toContain("ליאור");
    expect(preview.html).toContain("18,269.05");
  });

  it("carries no marketing figure into the preview either", async () => {
    const preview = await buildDiscountNoticePreview(row, [
      { name: "ליאור", email: "liorfit1@gmail.com" },
    ]);

    expect(preview.html).not.toContain("שיווק");
  });
});
