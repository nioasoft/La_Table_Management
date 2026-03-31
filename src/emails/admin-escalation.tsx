import {
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./components/email-layout";

interface AdminEscalationEmailProps {
  supplier_name?: string;
  period?: string;
  original_sent_date?: string;
  reminders_sent?: string;
}

export function AdminEscalationEmail({
  supplier_name = "{{supplier_name}}",
  period = "{{period}}",
  original_sent_date = "{{original_sent_date}}",
  reminders_sent = "{{reminders_sent}}",
}: AdminEscalationEmailProps) {
  const subject = `התראה: הספק ${supplier_name} לא העלה דוח`;

  return (
    <EmailLayout preview={subject}>
      <Section style={section}>
        <Text style={heading}>⚠️ התראה: ספק לא העלה דוח</Text>
        <Text style={text}>שלום רעות,</Text>
        <Text style={text}>
          הספק <strong>{supplier_name}</strong> לא העלה את דוח העמלות עבור
          התקופה <strong>{period}</strong>.
        </Text>
        <Text style={detailsText}>
          📅 תאריך שליחת הבקשה המקורית: {original_sent_date}
          <br />
          🔔 מספר תזכורות שנשלחו: {reminders_sent}
        </Text>
        <Text style={text}>
          נדרשת פנייה ידנית לספק לקבלת הדוח.
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
  color: "#dc2626",
  fontSize: "18px",
  fontWeight: "600",
  lineHeight: "28px",
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

const detailsText: React.CSSProperties = {
  color: "#333333",
  fontSize: "14px",
  lineHeight: "28px",
  margin: "16px 0",
  textAlign: "right" as const,
  backgroundColor: "#f9fafb",
  padding: "12px 16px",
  borderRadius: "6px",
  borderRight: "3px solid #dc2626",
};

export default AdminEscalationEmail;
