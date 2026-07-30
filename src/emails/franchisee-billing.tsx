import {
  Body,
  Column,
  Container,
  Head,
  Html,
  Preview,
  Row,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";

const HEBREW_MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
] as const;

export interface FranchiseeBillingEmailProps {
  readonly ownerName: string;
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
  readonly marketingRateSnapshot: string;
  readonly marketing: string;
  readonly subtotal: string;
  readonly total: string;
}

function monthName(month: number): string {
  return HEBREW_MONTHS[month - 1] ?? String(month);
}

function formatExactDecimal(value: string): string {
  const match = value.trim().match(/^(-?)(\d+)(?:\.(\d+))?$/);
  if (!match) return value;
  const sign = match[1] ?? "";
  const integer = (match[2] ?? "0").replace(/\B(?=(\d{3})+(?!\d))/g, ",");
  const fraction = (match[3] ?? "").replace(/0+$/, "");
  return `${sign}${integer}${fraction ? `.${fraction}` : ""}`;
}

function money(value: string): string {
  return `₪\u00a0${formatExactDecimal(value)}`;
}

function rate(value: string): string {
  return formatExactDecimal(value);
}

export function franchiseeBillingEmailSubject(
  props: Pick<
    FranchiseeBillingEmailProps,
    "franchiseeName" | "periodMonth" | "periodYear"
  >,
): string {
  return `חיוב תמלוגים ושיווק · ${props.franchiseeName} · ${monthName(props.periodMonth)} ${props.periodYear}`;
}

function ChargeRow({
  label,
  value,
}: {
  readonly label: string;
  readonly value: string;
}) {
  return (
    <Row>
      <Column style={labelColumn}>{label}</Column>
      <Column style={valueColumn}>
        <span dir="ltr">{value}</span>
      </Column>
    </Row>
  );
}

/**
 * Renders the Hebrew franchisee royalty charge and deferral notice.
 */
export function FranchiseeBillingEmail(
  props: FranchiseeBillingEmailProps,
) {
  const subject = franchiseeBillingEmailSubject(props);
  const period = `${monthName(props.periodMonth)} ${props.periodYear}`;

  return (
    <Html lang="he" dir="rtl">
      <Head>
        <meta charSet="utf-8" />
        <meta
          name="viewport"
          content="width=device-width, initial-scale=1.0"
        />
      </Head>
      <Preview>{subject}</Preview>
      <Body style={body}>
        <Container style={container}>
          <Text style={paragraph}>שלום {props.ownerName},</Text>
          <Text style={paragraph}>
            להלן החיוב של {props.franchiseeName} לחודש {period}.
          </Text>

          <Section style={charges}>
            <ChargeRow
              label='מחזור כולל מע"מ'
              value={money(props.grossBase)}
            />
            <ChargeRow
              label='מחזור ללא מע"מ'
              value={money(props.netBase)}
            />
            <ChargeRow
              label={`תמלוגים לפי הסכם, ${rate(props.tierRate)}%`}
              value={money(props.royaltyFull)}
            />
            <ChargeRow
              label={`דחיית חיוב, ${rate(props.discountRatePoints)} נק' אחוז`}
              value={`−${money(props.discountValue)}`}
            />
            <ChargeRow
              label={`תמלוגים לחיוב, ${rate(props.effectiveRate)}%`}
              value={money(props.royalty)}
            />
            <ChargeRow
              label={`דמי שיווק ${rate(props.marketingRateSnapshot)}%`}
              value={money(props.marketing)}
            />
            <ChargeRow
              label='סה"כ לפני מע"מ'
              value={money(props.subtotal)}
            />
            <ChargeRow
              label='לתשלום כולל מע"מ'
              value={money(props.total)}
            />
          </Section>

          <Text style={paragraph}>
            הסכום שנדחה אינו מבוטל. נעדכן אתכם לגבי מועד חיובו.
          </Text>
          <Text style={paragraph}>החשבונית תגיע בנפרד.</Text>
          <Text style={signature}>
            בברכה,
            <br />
            רעות
            <br />
            לה טייבל ניהול
          </Text>
        </Container>
      </Body>
    </Html>
  );
}

const body: React.CSSProperties = {
  backgroundColor: "#f6f9fc",
  direction: "rtl",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Arial, sans-serif',
  margin: 0,
  padding: "24px 8px",
};

const container: React.CSSProperties = {
  backgroundColor: "#ffffff",
  border: "1px solid #e6ebf1",
  borderRadius: "8px",
  margin: "0 auto",
  maxWidth: "600px",
  padding: "28px 24px",
};

const paragraph: React.CSSProperties = {
  color: "#222222",
  fontSize: "15px",
  lineHeight: "24px",
  margin: "0 0 18px",
  textAlign: "right",
};

const charges: React.CSSProperties = {
  borderBottom: "1px solid #dfe3e8",
  borderTop: "1px solid #dfe3e8",
  margin: "22px 0",
  padding: "12px 0",
};

const labelColumn: React.CSSProperties = {
  color: "#333333",
  fontSize: "14px",
  lineHeight: "22px",
  padding: "5px 0",
  textAlign: "right",
};

const valueColumn: React.CSSProperties = {
  color: "#111111",
  fontSize: "14px",
  fontVariantNumeric: "tabular-nums",
  lineHeight: "22px",
  padding: "5px 0 5px 12px",
  textAlign: "left",
  whiteSpace: "nowrap",
  width: "34%",
};

const signature: React.CSSProperties = {
  ...paragraph,
  marginBottom: 0,
};

FranchiseeBillingEmail.PreviewProps = {
  ownerName: "דנה",
  franchiseeName: "ויני יהוד",
  periodYear: 2026,
  periodMonth: 6,
  grossBase: "1180000.123456",
  netBase: "1000000.104624",
  tierRate: "5.00",
  discountRatePoints: "1.00",
  effectiveRate: "4.00",
  royaltyFull: "50000.005231",
  discountValue: "10000.001046",
  royalty: "40000.004185",
  marketingRateSnapshot: "0.75",
  marketing: "7500.000785",
  subtotal: "47500.004970",
  total: "56050.005865",
} satisfies FranchiseeBillingEmailProps;

export default FranchiseeBillingEmail;
