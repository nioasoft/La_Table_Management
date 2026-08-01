import { render } from "@react-email/components";
import { describe, expect, it } from "vitest";

import {
  FranchiseeBillingEmail,
  franchiseeBillingEmailSubject,
} from "@/emails/franchisee-billing";
import { canonicalStoredDecimal } from "@/lib/franchisee-billing-approval";
import { calculateRoyalty } from "@/lib/royalty";

const calculation = calculateRoyalty({
  receipts: 1180.123456,
  tips: 0,
  includeTips: false,
  tiers: [{ upTo: null, rate: 5 }],
  tierBasis: "gross",
  marketingRate: 0.75,
  discountRatePoints: 1,
  vat: 0.18,
});
const moneyValue = (value: number) => canonicalStoredDecimal(value, 6);
const rateValue = (value: number) => canonicalStoredDecimal(value, 2);
const props = {
  ownerName: "דנה",
  franchiseeName: "ויני יהוד",
  periodYear: 2026,
  periodMonth: 6,
  grossBase: moneyValue(calculation.grossBase),
  netBase: moneyValue(calculation.netBase),
  tierRate: rateValue(calculation.tierRate),
  discountRatePoints: rateValue(1),
  effectiveRate: rateValue(calculation.effectiveRate),
  royaltyFull: moneyValue(calculation.royaltyFull),
  discountValue: moneyValue(calculation.discountValue),
  royalty: moneyValue(calculation.royalty),
  marketingRateSnapshot: rateValue(0.75),
  marketing: moneyValue(calculation.marketing),
  subtotal: moneyValue(calculation.subtotal),
  total: moneyValue(calculation.total),
} as const;

function displayDecimal(value: string): string {
  const [integer = "0", fraction = ""] = value.split(".");
  const grouped = integer.replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const trimmed = fraction.replace(/0+$/, "");
  return trimmed ? `${grouped}.${trimmed}` : grouped;
}

describe("FranchiseeBillingEmail", () => {
  it("uses the approved Hebrew subject verbatim", () => {
    expect(franchiseeBillingEmailSubject(props)).toBe(
      "חיוב תמלוגים ושיווק · ויני יהוד · יוני 2026",
    );
  });

  it("renders the complete approved body verbatim and in order", async () => {
    const html = await render(FranchiseeBillingEmail(props));
    const text = await render(FranchiseeBillingEmail(props), {
      plainText: true,
    });
    // Amounts render in agorot; percentages keep their exact digits.
    const amount = (value: string) =>
      `₪\u00a0${Number(value).toLocaleString("he-IL", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      })}`;
    const expected = [
      "שלום דנה,",
      "",
      "להלן החיוב של ויני יהוד לחודש יוני 2026.",
      "",
      `מחזור כולל מע"מ${amount(props.grossBase)}`,
      "",
      `מחזור ללא מע"מ${amount(props.netBase)}`,
      "",
      `תמלוגים לפי הסכם, ${displayDecimal(props.tierRate)}%${amount(props.royaltyFull)}`,
      "",
      `דחיית חיוב, ${displayDecimal(props.discountRatePoints)} נק' אחוז−${amount(props.discountValue)}`,
      "",
      `תמלוגים לחיוב, ${displayDecimal(props.effectiveRate)}%${amount(props.royalty)}`,
      "",
      `דמי שיווק ${displayDecimal(props.marketingRateSnapshot)}%${amount(props.marketing)}`,
      "",
      `סה"כ לפני מע"מ${amount(props.subtotal)}`,
      "",
      `לתשלום כולל מע"מ${amount(props.total)}`,
      "",
      "הסכום שנדחה אינו מבוטל. נעדכן אתכם לגבי מועד חיובו.",
      "",
      "החשבונית תגיע בנפרד.",
      "",
      "בברכה,",
      "רעות",
      "לה טייבל ניהול",
    ].join("\n");

    expect(html).toContain('dir="rtl"');
    expect(text).toBe(expected);
  });

  it("renders money in agorot, not in the six decimals the column stores", async () => {
    // Calculation and storage keep full precision; a document a franchisee
    // owner reads must not. This once sent ₪626,812.118644 to four owners.
    const text = await render(FranchiseeBillingEmail(props), {
      plainText: true,
    });
    const agorot = (value: string) =>
      Number(value).toLocaleString("he-IL", {
        minimumFractionDigits: 2,
        maximumFractionDigits: 2,
      });

    expect(text).toContain(`₪\u00a0${agorot(props.grossBase)}`);
    expect(text).toContain(`₪\u00a0${agorot(props.discountValue)}`);
    expect(text).toContain(`₪\u00a0${agorot(props.total)}`);
    expect(text).not.toMatch(/₪\u00a0[\d,]+\.\d{3,}/);
  });
});
