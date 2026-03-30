import {
  Button,
  Section,
  Text,
} from "@react-email/components";
import * as React from "react";
import { EmailLayout } from "./components/email-layout";

interface SupplierRequestEmailProps {
  entity_name?: string;
  period?: string;
  period_end_date?: string;
  upload_link?: string;
  deadline?: string;
  brand_name?: string;
  brand_names?: string;
}

export function SupplierRequestEmail({
  entity_name = "{{entity_name}}",
  period = "{{period}}",
  period_end_date = "{{period_end_date}}",
  upload_link = "{{upload_link}}",
  deadline = "{{deadline}}",
  brand_name = "La Table",
  brand_names = "{{brand_names}}",
}: SupplierRequestEmailProps) {
  const displayBrands = brand_names && brand_names !== "{{brand_names}}" ? brand_names : brand_name;
  const subject = `בקשת דוח עמלות רשת - ${period}`;

  return (
    <EmailLayout preview={subject}>
      <Section style={section}>
        <Text style={text}>שלום רב,</Text>
        <Text style={text}>
          נבקש מכם להעלות דוח עמלות רשת עבור קבוצת{" "}
          <span dir="ltr" style={{ unicodeBidi: "embed" }}>LA TABLE ({displayBrands})</span>{" "}
          לתקופה שמסתיימת ב-{period_end_date}, בקישור המצורף מטה.
        </Text>
        <Section style={buttonSection}>
          <Button style={button} href={upload_link}>
            קישור להעלאת הדוח
          </Button>
        </Section>
        <Text style={text}>נודה להעלאת הדוח בהקדם האפשרי.</Text>
        <Text style={text}>במידה וקיימת שאלה או תקלה בתהליך ההעלאה – נשמח לסייע.</Text>
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
  background: "#2563eb",
  backgroundColor: "#2563eb",
  borderRadius: "6px",
  border: "none",
  color: "#ffffff",
  fontSize: "14px",
  fontWeight: "600",
  textDecoration: "none",
  textAlign: "center" as const,
  display: "inline-block",
  padding: "14px 32px",
};

const signature: React.CSSProperties = {
  color: "#333333",
  fontSize: "14px",
  lineHeight: "24px",
  margin: "32px 0 0",
  textAlign: "right" as const,
};

export default SupplierRequestEmail;
