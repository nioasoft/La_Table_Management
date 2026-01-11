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

interface ReminderEmailProps {
  entity_name?: string;
  period?: string;
  upload_link?: string;
  deadline?: string;
  brand_name?: string;
}

export function ReminderEmail({
  entity_name = "{{entity_name}}",
  period = "{{period}}",
  upload_link = "{{upload_link}}",
  deadline = "{{deadline}}",
  brand_name = "La Table",
}: ReminderEmailProps) {
  const t = emailTranslations.reminder;
  const common = emailTranslations.common;

  // Build subject line using Hebrew translations
  const subject = emailSubjects.reminder(period);

  // Build body message using interpolation
  const reminderMessage = interpolateEmail(t.reminderMessage, {
    brandName: brand_name,
    period: period,
  });

  return (
    <EmailLayout preview={subject}>
      <Section style={section}>
        <Section style={urgentBanner}>
          <Text style={urgentText}>{t.reminderBadge}</Text>
        </Section>
        <Heading style={heading}>{t.heading}</Heading>
        <Text style={text}>{common.dear} {entity_name},</Text>
        <Text style={text}>{reminderMessage}</Text>
        <Section style={deadlineBox}>
          <Text style={deadlineLabel}>{t.deadlineLabel}</Text>
          <Text style={deadlineValue}>{deadline}</Text>
        </Section>
        <Text style={text}>{t.urgentMessage}</Text>
        <Section style={buttonSection}>
          <Button style={button} href={upload_link}>
            {t.submitButton}
          </Button>
        </Section>
        <Text style={smallText}>{t.disclaimerText}</Text>
        <Text style={signature}>
          {common.bestRegards}<br />
          {emailSignOff.team(brand_name)}
        </Text>
      </Section>
    </EmailLayout>
  );
}

// Styles
const section: React.CSSProperties = {
  padding: "0 20px",
};

const urgentBanner: React.CSSProperties = {
  backgroundColor: "#fef3c7",
  borderRadius: "6px",
  padding: "8px 16px",
  marginBottom: "20px",
  textAlign: "center" as const,
};

const urgentText: React.CSSProperties = {
  color: "#92400e",
  fontSize: "12px",
  fontWeight: "600",
  margin: "0",
  textTransform: "uppercase" as const,
  letterSpacing: "0.5px",
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

const smallText: React.CSSProperties = {
  color: "#666666",
  fontSize: "12px",
  lineHeight: "20px",
  margin: "16px 0",
  textAlign: "right" as const,
};

const deadlineBox: React.CSSProperties = {
  backgroundColor: "#fef2f2",
  border: "1px solid #fecaca",
  borderRadius: "6px",
  padding: "16px",
  margin: "24px 0",
  textAlign: "center" as const,
};

const deadlineLabel: React.CSSProperties = {
  color: "#991b1b",
  fontSize: "12px",
  fontWeight: "500",
  margin: "0 0 4px",
  textTransform: "uppercase" as const,
};

const deadlineValue: React.CSSProperties = {
  color: "#dc2626",
  fontSize: "18px",
  fontWeight: "600",
  margin: "0",
};

const buttonSection: React.CSSProperties = {
  textAlign: "center" as const,
  margin: "32px 0",
};

const button: React.CSSProperties = {
  backgroundColor: "#dc2626",
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

export default ReminderEmail;
