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
  emailSignOff,
} from "@/lib/translations/emails";

interface CustomEmailProps {
  entity_name?: string;
  period?: string;
  upload_link?: string;
  deadline?: string;
  brand_name?: string;
  customSubject?: string;
  customBody?: string;
}

export function CustomEmail({
  entity_name = "{{entity_name}}",
  period = "{{period}}",
  upload_link = "{{upload_link}}",
  deadline = "{{deadline}}",
  brand_name = "La Table",
  customSubject = "",
  customBody = "",
}: CustomEmailProps) {
  const t = emailTranslations.custom;
  const common = emailTranslations.common;

  // Use custom subject or default Hebrew subject
  const subject = customSubject || t.defaultSubject;

  // Parse custom body for basic formatting
  const paragraphs = customBody
    ? customBody.split("\n\n").filter((p) => p.trim())
    : [];

  // Build default message using interpolation
  const defaultGreeting = interpolateEmail(t.defaultGreeting, {
    entityName: entity_name,
  });
  const defaultMessage = interpolateEmail(t.defaultMessage, {
    brandName: brand_name,
    period: period,
  });

  return (
    <EmailLayout preview={subject}>
      <Section style={section}>
        <Heading style={heading}>{subject}</Heading>
        {paragraphs.length > 0 ? (
          paragraphs.map((paragraph, index) => (
            <Text key={index} style={text}>
              {paragraph}
            </Text>
          ))
        ) : (
          <>
            <Text style={text}>{defaultGreeting}</Text>
            <Text style={text}>{defaultMessage}</Text>
            {deadline && deadline !== "{{deadline}}" && (
              <Text style={text}>
                <strong>{t.deadlineLabel}</strong> {deadline}
              </Text>
            )}
          </>
        )}
        {upload_link && upload_link !== "{{upload_link}}" && (
          <Section style={buttonSection}>
            <Button style={button} href={upload_link}>
              {t.viewDetailsButton}
            </Button>
          </Section>
        )}
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

export default CustomEmail;
