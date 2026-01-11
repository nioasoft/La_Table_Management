import {
  Body,
  Container,
  Head,
  Html,
  Preview,
  Section,
  Text,
  Hr,
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
  footerText = "La Table Management",
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
          <Section style={footer}>
            <Text style={footerTextStyle}>{footerText}</Text>
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
  margin: "30px 0",
};

const footer: React.CSSProperties = {
  textAlign: "center" as const,
};

const footerTextStyle: React.CSSProperties = {
  color: "#8898aa",
  fontSize: "12px",
  lineHeight: "16px",
  margin: "4px 0",
};

export default EmailLayout;
