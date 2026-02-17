import {
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./components/email-layout";

interface AgreementExpiryEmailProps {
  franchisee_name?: string;
  expiry_date?: string;
  advance_notice_days?: string;
  reminder_type?: string;
  days_remaining?: string;
}

export function AgreementExpiryEmail({
  franchisee_name = "{{franchisee_name}}",
  expiry_date = "{{expiry_date}}",
  advance_notice_days = "{{advance_notice_days}}",
  reminder_type = "{{reminder_type}}",
  days_remaining = "{{days_remaining}}",
}: AgreementExpiryEmailProps) {
  const subject = `תזכורת: תפוגת ${reminder_type} - ${franchisee_name}`;

  return (
    <EmailLayout preview={subject}>
      <Section style={section}>
        <Text style={heading}>תזכורת ❗</Text>
        <Text style={text}>שלום לכולם,</Text>
        <Text style={text}>
          ברצוננו לעדכן כי ההסכם עם הזכיין / השוכר
          ב־<strong>{franchisee_name}</strong> מסתיים בהתאם לתנאיו,
          בתאריך: <strong>{expiry_date}</strong>
        </Text>
        <Text style={text}>
          עפ״י ההסכם יש לעדכן {advance_notice_days} יום קודם מראש.
        </Text>
        <Text style={detailsText}>
          ⏰ נותרו {days_remaining} ימים עד תאריך התפוגה
        </Text>
        <Text style={text}>
          בכל שאלה ניתן לפנות אליי.
        </Text>
        <Text style={signature}>
          תודה,
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

const heading: React.CSSProperties = {
  color: "#dc2626",
  fontSize: "20px",
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
  backgroundColor: "#fef3c7",
  padding: "12px 16px",
  borderRadius: "6px",
  borderRight: "3px solid #f59e0b",
};

const signature: React.CSSProperties = {
  color: "#333333",
  fontSize: "14px",
  lineHeight: "24px",
  margin: "32px 0 0",
  textAlign: "right" as const,
};

export default AgreementExpiryEmail;
