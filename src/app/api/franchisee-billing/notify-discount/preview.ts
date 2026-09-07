import { render } from "@react-email/components";

import {
  FranchiseeBillingEmail,
  franchiseeBillingEmailSubject,
  type FranchiseeBillingEmailProps,
} from "@/emails/franchisee-billing";

/** The stored row a discount notice is built from. */
export interface DiscountNoticeSource {
  readonly franchiseeName: string;
  readonly periodYear: number;
  readonly periodMonth: number;
  readonly grossBase: string;
  readonly netBase: string;
  readonly tierRate: string;
  readonly discountRatePoints: string;
  readonly effectiveRate: string;
  readonly royaltyFull: string;
  readonly discountValue: string;
  readonly royalty: string;
}

export interface DiscountNoticeRecipient {
  readonly name: string;
  readonly email: string;
}

export interface DiscountNoticePreview {
  readonly subject: string;
  readonly html: string;
  /** Which recipient's copy is shown — only the greeting differs. */
  readonly shownFor: string;
  readonly recipients: readonly string[];
}

export function discountNoticeProps(
  row: DiscountNoticeSource,
  ownerName: string,
): FranchiseeBillingEmailProps {
  return {
    ownerName,
    franchiseeName: row.franchiseeName,
    periodYear: row.periodYear,
    periodMonth: row.periodMonth,
    grossBase: row.grossBase,
    netBase: row.netBase,
    tierRate: row.tierRate,
    discountRatePoints: row.discountRatePoints,
    effectiveRate: row.effectiveRate,
    royaltyFull: row.royaltyFull,
    discountValue: row.discountValue,
    royalty: row.royalty,
  };
}

/**
 * Renders exactly what the send would produce, and sends nothing. One copy is
 * rendered rather than one per recipient: the greeting is the only thing that
 * differs between them, and the screen says so next to the preview.
 */
export async function buildDiscountNoticePreview(
  row: DiscountNoticeSource,
  recipients: readonly DiscountNoticeRecipient[],
): Promise<DiscountNoticePreview> {
  const [first] = recipients;
  if (!first) throw new Error("a preview needs at least one recipient");
  const props = discountNoticeProps(row, first.name);
  return {
    subject: franchiseeBillingEmailSubject(props),
    html: await render(FranchiseeBillingEmail(props)),
    shownFor: first.email,
    recipients: recipients.map((recipient) => recipient.email),
  };
}
