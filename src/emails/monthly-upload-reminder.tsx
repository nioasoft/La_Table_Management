import { Button, Heading, Section, Text } from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./components/email-layout";

interface MonthlyUploadReminderEmailProps {
  recipient_name?: string;
  period_label?: string;
  upload_link?: string;
}

export function MonthlyUploadReminderEmail({
  recipient_name = "רעות",
  period_label = "{{period_label}}",
  upload_link = "{{upload_link}}",
}: MonthlyUploadReminderEmailProps) {
  const preview = `תזכורת חודשית: העלאת דוח "חבר" ודוחות טאביט - ${period_label}`;

  return (
    <EmailLayout preview={preview}>
      <Section style={section}>
        <Heading style={heading}>תזכורת חודשית</Heading>
        <Text style={text}>שלום {recipient_name},</Text>
        <Text style={text}>
          תזכורת חודשית להעלאת הדוחות החסרים עבור חודש <strong>{period_label}</strong>:
        </Text>
        <Section style={listSection}>
          <Text style={listItem}>• דוח של &quot;חבר&quot;</Text>
          <Text style={listItem}>• דוחות טאביט (Tabit) של הסניפים</Text>
        </Section>
        <Text style={text}>ניתן להעלות את הדוחות ישירות במסך הלקוחות:</Text>
        <Section style={buttonSection}>
          <Button href={upload_link} style={button}>
            מעבר להעלאת דוחות
          </Button>
        </Section>
        <Text style={hint}>
          הקישור מוביל למסך &quot;מסמכי לקוחות&quot;. ניתן לסנן לפי לקוח ותקופה ולצרף את הקבצים המתאימים.
        </Text>
      </Section>
    </EmailLayout>
  );
}

const section = {
  padding: "24px 0",
};

const heading = {
  color: "#1f2937",
  fontSize: "22px",
  fontWeight: "700",
  margin: "0 0 16px 0",
  textAlign: "right" as const,
};

const text = {
  color: "#374151",
  fontSize: "15px",
  lineHeight: "1.7",
  margin: "0 0 12px 0",
  textAlign: "right" as const,
};

const listSection = {
  backgroundColor: "#f9fafb",
  borderRadius: "6px",
  padding: "14px 18px",
  margin: "12px 0",
};

const listItem = {
  color: "#111827",
  fontSize: "15px",
  lineHeight: "1.8",
  margin: "4px 0",
  textAlign: "right" as const,
};

const buttonSection = {
  textAlign: "center" as const,
  margin: "24px 0 12px 0",
};

const button = {
  backgroundColor: "#2563eb",
  borderRadius: "6px",
  color: "#ffffff",
  display: "inline-block",
  fontSize: "15px",
  fontWeight: "600",
  padding: "12px 28px",
  textDecoration: "none",
};

const hint = {
  color: "#6b7280",
  fontSize: "13px",
  lineHeight: "1.6",
  margin: "16px 0 0 0",
  textAlign: "right" as const,
};
