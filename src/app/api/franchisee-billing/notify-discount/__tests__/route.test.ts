import { describe, expect, it } from "vitest";

import {
  blockReason,
  resolveRecipients,
} from "@/app/api/franchisee-billing/notify-discount/route";

const ROW = {
  id: "billing-1",
  franchiseeName: "ויני יהוד",
  owners: [
    { name: "דנה", email: "Dana@Example.com" },
    { name: "יואב", email: "yoav@example.com" },
  ],
  periodYear: 2026,
  periodMonth: 8,
  status: "approved",
  grossBase: "1180",
  netBase: "1000",
  tierRate: "4.00",
  discountRatePoints: "1.00",
  effectiveRate: "3.00",
  royaltyFull: "40",
  discountValue: "10",
  royalty: "30",
  marketingRateSnapshot: "1.00",
  marketing: "10",
  subtotal: "40",
  total: "47.2",
} as const;

describe("blockReason", () => {
  it("allows an approved row that carries a discount", () => {
    expect(blockReason(ROW)).toBeNull();
  });

  it("refuses a draft row — the numbers are not final yet", () => {
    expect(blockReason({ ...ROW, status: "draft" })).toBe(
      "אפשר לשלוח הודעת הנחה רק אחרי אישור החודש",
    );
  });

  it("refuses a row without a discount — there is nothing to announce", () => {
    expect(blockReason({ ...ROW, discountValue: "0" })).toBe(
      "לשורה הזו אין הנחה — אין מה להודיע",
    );
  });
});

describe("resolveRecipients", () => {
  it("accepts only addresses that belong to the franchisee's owners", () => {
    expect(resolveRecipients(ROW, ["attacker@example.com"])).toBe(
      "הכתובת attacker@example.com אינה שייכת לבעלים של ויני יהוד",
    );
  });

  it("matches case-insensitively and drops duplicates", () => {
    expect(
      resolveRecipients(ROW, ["dana@example.com", "DANA@EXAMPLE.COM"]),
    ).toEqual([{ name: "דנה", email: "Dana@Example.com" }]);
  });
});
