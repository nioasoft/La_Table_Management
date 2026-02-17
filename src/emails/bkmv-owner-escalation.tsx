import {
  Button,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./components/email-layout";

interface BkmvOwnerEscalationEmailProps {
  original_sent_date?: string;
  start_date?: string;
  upload_link?: string;
  franchisee_name?: string;
}

export function BkmvOwnerEscalationEmail({
  original_sent_date = "{{original_sent_date}}",
  start_date = "{{start_date}}",
  upload_link = "{{upload_link}}",
  franchisee_name = "{{franchisee_name}}",
}: BkmvOwnerEscalationEmailProps) {
  const subject = `תזכורת: קובץ מבנה אחיד BKMV טרם הועלה - ${franchisee_name}`;

  return (
    <EmailLayout preview={subject}>
      <Section style={section}>
        <Text style={text}>שלום רב,</Text>
        <Text style={text}>
          בתאריך: <strong>{original_sent_date}</strong> נשלח להנהלת החשבונות שלכם
          מייל להעלאת קובץ במבנה אחיד, וטרם טופל.
        </Text>
        <Text style={text}>
          נבקשכם להעלות קובץ מבנה אחיד מסוג BKMV
          עבור התקופה החל מ־{start_date} ועד היום,
          בקישור המצורף מטה.
        </Text>
        <Section style={buttonSection}>
          <Button style={button} href={upload_link}>
            📎 קישור להעלאת הקובץ
          </Button>
        </Section>
        <Text style={text}>
          הקובץ נדרש לצורך ריכוז ובקרה שוטפת ברמת הקבוצה.
        </Text>
        <Text style={text}>
          נודה להעלאתו בהקדם האפשרי.
        </Text>
        <Text style={text}>
          במידה וקיימת שאלה או תקלה בתהליך ההעלאה – נשמח לסייע.
        </Text>
        <Text style={signature}>
          תודה רבה על שיתוף הפעולה,
          <br />
          רעות
        </Text>
      </Section>
    </EmailLayout>
  );
}

// Styles
const section: React.CSSProperties = {
  padding: "0 20px",
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

export default BkmvOwnerEscalationEmail;
