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

const signature = emailTranslations.signature;

interface EmailLayoutProps {
  preview: string;
  children: React.ReactNode;
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
            <Text style={signatureName}>{signature.name}</Text>
            <Text style={signatureCompany}>{signature.company}</Text>
            <Text style={signatureAddress}>{signature.address}</Text>
            <Text style={signaturePhone}>{signature.phone}</Text>
          </Section>
          <Hr style={brandsDivider} />
          {/* Brand Names */}
          <Section style={brandsSection}>
            <Row>
              {signature.brands.map((brand) => (
                <Column key={brand.name} style={brandColumn}>
                  <Text style={brandStyle(brand)}>{brand.name}</Text>
                </Column>
              ))}
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
  width: `${Math.floor(100 / signature.brands.length)}%`,
};

function brandStyle(
  brand: (typeof signature.brands)[number]
): React.CSSProperties {
  return {
    color: brand.color,
    fontSize: "12px",
    fontWeight: "700",
    fontStyle: brand.italic ? "italic" : "normal",
    margin: "0",
    letterSpacing: "1px",
  };
}

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
