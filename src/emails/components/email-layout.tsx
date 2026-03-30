import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
  Hr,
  Row,
  Column,
} from "@react-email/components";
import * as React from "react";
import { emailTranslations } from "@/lib/translations/emails";

interface EmailLayoutProps {
  preview: string;
  children: React.ReactNode;
  footerText?: string;
}

export function EmailLayout({
  preview,
  children,
}: EmailLayoutProps) {
  return (
    <Html lang="he" dir="rtl">
      <Head>
        <meta charSet="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1.0" />
      </Head>
      <Preview>{preview}</Preview>
      <Body style={main}>
        <Container style={container}>
          {children}
          <Hr style={hr} />
          {/* Signature Block */}
          <Section style={signatureSection}>
            <Text style={signatureName}>רעות</Text>
            <Text style={signatureCompany}>קבוצת LA TABLE</Text>
            <Text style={signatureAddress}>
              שדרות משה גושן 16, קרית מוצקין
            </Text>
            <Text style={signaturePhone}>
              T: 04-8759732 &nbsp;&nbsp; F: 04-8763534
            </Text>
          </Section>
          <Hr style={brandsDivider} />
          {/* Brand Names */}
          <Section style={brandsSection}>
            <Row>
              <Column style={brandColumn}>
                <Text style={brandVinni}>VINNI</Text>
              </Column>
              <Column style={brandColumn}>
                <Text style={brandKingKong}>KING KONG</Text>
              </Column>
              <Column style={brandColumn}>
                <Text style={brandMinna}>minna tomei</Text>
              </Column>
            </Row>
          </Section>
          <Hr style={hrLight} />
          <Section style={footerSection}>
            <Text style={footerTextStyle}>
              {emailTranslations.layout.autoEmailNotice}
            </Text>
          </Section>
        </Container>
      </Body>
    </Html>
  );
}

// Styles
const main: React.CSSProperties = {
  backgroundColor: "#f6f9fc",
  fontFamily:
    '-apple-system, BlinkMacSystemFont, "Segoe UI", Roboto, "Helvetica Neue", Ubuntu, sans-serif',
};

const container: React.CSSProperties = {
  backgroundColor: "#ffffff",
  margin: "0 auto",
  padding: "40px 20px",
  marginTop: "20px",
  marginBottom: "20px",
  borderRadius: "8px",
  maxWidth: "600px",
};

const hr: React.CSSProperties = {
  borderColor: "#e6ebf1",
  margin: "30px 0 20px",
};

const signatureSection: React.CSSProperties = {
  textAlign: "right" as const,
  padding: "0 20px",
};

const signatureName: React.CSSProperties = {
  color: "#333333",
  fontSize: "16px",
  fontWeight: "700",
  margin: "0 0 2px",
  textAlign: "right" as const,
};

const signatureCompany: React.CSSProperties = {
  color: "#333333",
  fontSize: "14px",
  fontWeight: "600",
  margin: "0 0 8px",
  textAlign: "right" as const,
  letterSpacing: "1px",
};

const signatureAddress: React.CSSProperties = {
  color: "#666666",
  fontSize: "12px",
  margin: "0 0 2px",
  textAlign: "right" as const,
};

const signaturePhone: React.CSSProperties = {
  color: "#666666",
  fontSize: "12px",
  margin: "0",
  textAlign: "right" as const,
  direction: "ltr" as const,
};

const brandsDivider: React.CSSProperties = {
  borderColor: "#e6ebf1",
  margin: "16px 0",
};

const brandsSection: React.CSSProperties = {
  textAlign: "center" as const,
  padding: "0 20px",
};

const brandColumn: React.CSSProperties = {
  textAlign: "center" as const,
  width: "33%",
};

const brandVinni: React.CSSProperties = {
  color: "#1e3a5f",
  fontSize: "13px",
  fontWeight: "700",
  fontStyle: "italic",
  margin: "0",
  letterSpacing: "1px",
};

const brandKingKong: React.CSSProperties = {
  color: "#d6006e",
  fontSize: "12px",
  fontWeight: "800",
  margin: "0",
  letterSpacing: "1px",
};

const brandMinna: React.CSSProperties = {
  color: "#1a1a1a",
  fontSize: "12px",
  fontWeight: "600",
  margin: "0",
  letterSpacing: "0.5px",
};

const brandNatanzon: React.CSSProperties = {
  color: "#6b3a2a",
  fontSize: "13px",
  fontWeight: "700",
  margin: "0",
  letterSpacing: "2px",
};

const hrLight: React.CSSProperties = {
  borderColor: "#f0f0f0",
  margin: "16px 0 8px",
};

const footerSection: React.CSSProperties = {
  textAlign: "center" as const,
};

const footerTextStyle: React.CSSProperties = {
  color: "#8898aa",
  fontSize: "11px",
  lineHeight: "16px",
  margin: "4px 0",
};

export default EmailLayout;
