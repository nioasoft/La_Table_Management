import {
  Button,
  Heading,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./components/email-layout";
import {
  emailTranslations,
  interpolateEmail,
  emailSubjects,
  emailSignOff,
} from "@/lib/translations/emails";

interface FranchiseeRequestEmailProps {
  entity_name?: string;
  period?: string;
  upload_link?: string;
  deadline?: string;
  brand_name?: string;
}

export function FranchiseeRequestEmail({
  entity_name = "{{entity_name}}",
  period = "{{period}}",
  upload_link = "{{upload_link}}",
  deadline = "{{deadline}}",
  brand_name = "La Table",
}: FranchiseeRequestEmailProps) {
  const t = emailTranslations.franchiseeRequest;
  const common = emailTranslations.common;

  // Build subject line using Hebrew translations
  const subject = emailSubjects.franchiseeRequest(period);

  // Build body message using interpolation
  const requestMessage = interpolateEmail(t.requestMessage, {
    brandName: brand_name,
    period: period,
  });

  return (
    <EmailLayout preview={subject}>
      <Section style={section}>
        <Heading style={heading}>{t.heading}</Heading>
        <Text style={text}>{common.dear} {entity_name},</Text>
        <Text style={text}>{requestMessage}</Text>
        <Text style={text}>
          <strong>{t.deadlineLabel}</strong> {deadline}
        </Text>
        <Section style={infoBox}>
          <Text style={infoText}>
            {t.infoBoxText}
          </Text>
        </Section>
        <Section style={buttonSection}>
          <Button style={button} href={upload_link}>
            {t.uploadButton}
          </Button>
        </Section>
        <Text style={text}>
          {t.helpText}
        </Text>
        <Text style={signature}>
          {common.bestRegards}<br />
          {emailSignOff.managementTeam(brand_name)}
        </Text>
      </Section>
    </EmailLayout>
  );
}

// Styles
const section: React.CSSProperties = {
  padding: "0 20px",
};

const heading: React.CSSProperties = {
  color: "#1a1a1a",
  fontSize: "24px",
  fontWeight: "600",
  lineHeight: "32px",
  margin: "0 0 20px",
  textAlign: "right" as const,
};

const text: React.CSSProperties = {
  color: "#333333",
  fontSize: "14px",
  lineHeight: "24px",
  margin: "16px 0",
  textAlign: "right" as const,
};

const infoBox: React.CSSProperties = {
  backgroundColor: "#f0f9ff",
  border: "1px solid #bae6fd",
  borderRadius: "6px",
  padding: "16px",
  margin: "24px 0",
};

const infoText: React.CSSProperties = {
  color: "#0369a1",
  fontSize: "13px",
  lineHeight: "20px",
  margin: "0",
  textAlign: "right" as const,
};

const buttonSection: React.CSSProperties = {
  textAlign: "center" as const,
  margin: "32px 0",
};

const button: React.CSSProperties = {
  backgroundColor: "#2563eb",
  borderRadius: "6px",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "12px 24px",
};

const signature: React.CSSProperties = {
  color: "#333333",
  fontSize: "14px",
  lineHeight: "24px",
  margin: "32px 0 0",
  textAlign: "right" as const,
};

export default FranchiseeRequestEmail;
