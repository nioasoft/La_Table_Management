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
  emailSubjects,
  emailSignOff,
} from "@/lib/translations/emails";

interface UploadNotificationEmailProps {
  entity_name?: string;
  entity_type?: string;
  file_name?: string;
  file_size?: string;
  uploader_email?: string;
  upload_date?: string;
  process_link?: string;
  brand_name?: string;
}

export function UploadNotificationEmail({
  entity_name = "{{entity_name}}",
  entity_type = "{{entity_type}}",
  file_name = "{{file_name}}",
  file_size = "{{file_size}}",
  uploader_email = "{{uploader_email}}",
  upload_date = "{{upload_date}}",
  process_link = "{{process_link}}",
  brand_name = "La Table",
}: UploadNotificationEmailProps) {
  const t = emailTranslations.uploadNotification;
  const common = emailTranslations.common;

  // Build subject line using Hebrew translations
  const subject = emailSubjects.uploadNotification(file_name, entity_name);

  // Format entity type for display (Hebrew)
  const entityTypeDisplay = entity_type === "supplier"
    ? common.entityTypes.supplier
    : entity_type === "franchisee"
    ? common.entityTypes.franchisee
    : entity_type === "brand"
    ? common.entityTypes.brand
    : entity_type;

  return (
    <EmailLayout preview={subject}>
      <Section style={section}>
        <div style={notificationBadge}>
          <Text style={notificationText}>{t.newUploadBadge}</Text>
        </div>
        <Heading style={heading}>
          {t.heading}
        </Heading>
        <Text style={text}>
          {t.introMessage}
        </Text>

        <Section style={detailsSection}>
          <div style={detailRow}>
            <Text style={detailLabel}>{t.details.entity}</Text>
            <Text style={detailValue}>{entity_name} ({entityTypeDisplay})</Text>
          </div>
          <div style={detailRow}>
            <Text style={detailLabel}>{t.details.fileName}</Text>
            <Text style={detailValue} dir="ltr">{file_name}</Text>
          </div>
          <div style={detailRow}>
            <Text style={detailLabel}>{t.details.fileSize}</Text>
            <Text style={detailValue} dir="ltr">{file_size}</Text>
          </div>
          {uploader_email && uploader_email !== "{{uploader_email}}" && (
            <div style={detailRow}>
              <Text style={detailLabel}>{t.details.uploadedBy}</Text>
              <Text style={detailValue} dir="ltr">{uploader_email}</Text>
            </div>
          )}
          <div style={detailRow}>
            <Text style={detailLabel}>{t.details.uploadDate}</Text>
            <Text style={detailValue}>{upload_date}</Text>
          </div>
        </Section>

        <Section style={buttonSection}>
          <Button style={button} href={process_link}>
            {t.reviewButton}
          </Button>
        </Section>

        <Text style={helpText}>
          {t.helpText}
        </Text>

        <Text style={signature}>
          {common.bestRegards}<br />
          {emailSignOff.system(brand_name)}
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

const detailsSection: React.CSSProperties = {
  backgroundColor: "#f8f9fa",
  borderRadius: "8px",
  padding: "16px",
  margin: "24px 0",
};

const detailRow: React.CSSProperties = {
  display: "flex",
  justifyContent: "space-between",
  marginBottom: "8px",
};

const detailLabel: React.CSSProperties = {
  color: "#666666",
  fontSize: "13px",
  fontWeight: "500",
  margin: "0",
  textAlign: "right" as const,
};

const detailValue: React.CSSProperties = {
  color: "#333333",
  fontSize: "13px",
  fontWeight: "600",
  margin: "0",
  textAlign: "left" as const,
};

const buttonSection: React.CSSProperties = {
  textAlign: "center" as const,
  margin: "32px 0",
};

const button: React.CSSProperties = {
  backgroundColor: "#16a34a",
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

const notificationBadge: React.CSSProperties = {
  backgroundColor: "#dcfce7",
  borderRadius: "4px",
  padding: "4px 12px",
  marginBottom: "16px",
  display: "inline-block",
};

const notificationText: React.CSSProperties = {
  color: "#16a34a",
  fontSize: "12px",
  fontWeight: "600",
  margin: "0",
};

export default UploadNotificationEmail;
