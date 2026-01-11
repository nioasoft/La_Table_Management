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

interface FileRequestEmailProps {
  recipient_name?: string;
  entity_name?: string;
  document_type?: string;
  upload_link?: string;
  due_date?: string;
  description?: string;
  brand_name?: string;
  is_reminder?: string;
}

export function FileRequestEmail({
  recipient_name = "{{recipient_name}}",
  entity_name = "{{entity_name}}",
  document_type = "{{document_type}}",
  upload_link = "{{upload_link}}",
  due_date = "{{due_date}}",
  description = "{{description}}",
  brand_name = "La Table",
  is_reminder = "",
}: FileRequestEmailProps) {
  const isReminder = is_reminder === "true";
  const t = emailTranslations.fileRequest;
  const common = emailTranslations.common;

  // Build subject line using Hebrew translations
  const subject = emailSubjects.fileRequest(document_type, entity_name, isReminder);

  // Build body messages using interpolation
  const requestMessage = interpolateEmail(t.requestMessage, {
    documentType: document_type,
    entityName: entity_name,
  });
  const reminderMessage = interpolateEmail(t.reminderMessage, {
    documentType: document_type,
    entityName: entity_name,
  });

  return (
    <EmailLayout preview={subject}>
      <Section style={section}>
        {isReminder && (
          <div style={reminderBadge}>
            <Text style={reminderText}>{t.reminderBadge}</Text>
          </div>
        )}
        <Heading style={heading}>
          {isReminder ? t.headingReminder : t.headingRequest}
        </Heading>
        <Text style={text}>{common.dear} {recipient_name},</Text>
        {isReminder ? (
          <Text style={text}>{reminderMessage}</Text>
        ) : (
          <Text style={text}>{requestMessage}</Text>
        )}
        {description && description !== "{{description}}" && (
          <Text style={text}>{description}</Text>
        )}
        {due_date && due_date !== "{{due_date}}" && (
          <Text style={text}>
            {common.submitBy} <strong>{due_date}</strong>
          </Text>
        )}
        <Section style={buttonSection}>
          <Button style={button} href={upload_link}>
            {t.uploadButton}
          </Button>
        </Section>
        <Text style={helpText}>
          {t.helpText}
        </Text>
        <Text style={text}>
          {common.contactUs}
        </Text>
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

const helpText: React.CSSProperties = {
  color: "#666666",
  fontSize: "12px",
  lineHeight: "20px",
  margin: "16px 0",
  textAlign: "center" as const,
};

const signature: React.CSSProperties = {
  color: "#333333",
  fontSize: "14px",
  lineHeight: "24px",
  margin: "32px 0 0",
  textAlign: "right" as const,
};

const reminderBadge: React.CSSProperties = {
  backgroundColor: "#fef3c7",
  borderRadius: "4px",
  padding: "4px 12px",
  marginBottom: "16px",
  display: "inline-block",
};

const reminderText: React.CSSProperties = {
  color: "#d97706",
  fontSize: "12px",
  fontWeight: "600",
  margin: "0",
};

export default FileRequestEmail;
