import "dotenv/config";
import { randomUUID } from "crypto";
import { render } from "@react-email/components";
import { database } from "../src/db";
import { emailTemplate } from "../src/db/schema";
import { eq } from "drizzle-orm";

// Import all React Email templates
import { SupplierRequestEmail } from "../src/emails/supplier-request";
import { FranchiseeRequestEmail } from "../src/emails/franchisee-request";
import { BkmvRequestEmail } from "../src/emails/bkmv-request";
import { FileRequestEmail } from "../src/emails/file-request";
import { ReminderEmail } from "../src/emails/reminder";
import { UploadNotificationEmail } from "../src/emails/upload-notification";
import { AdminEscalationEmail } from "../src/emails/admin-escalation";
import { BkmvOwnerEscalationEmail } from "../src/emails/bkmv-owner-escalation";
import { AgreementExpiryEmail } from "../src/emails/agreement-expiry";

const SEED_TEMPLATES = [
  {
    name: "בקשת דוח עמלות מספק",
    code: "supplier_request",
    category: "supplier_request",
    description: "בקשת דוח עמלות מספק לתקופה מסוימת - נשלח לספקים",
    subject: "בקשת דוח עמלות רשת - {{period}}",
    variables: ["entity_name", "period", "upload_link", "deadline", "brand_name", "brand_names"],
    render: () =>
      SupplierRequestEmail({
        entity_name: "{{entity_name}}",
        period: "{{period}}",
        upload_link: "{{upload_link}}",
        deadline: "{{deadline}}",
        brand_name: "{{brand_name}}",
        brand_names: "{{brand_names}}",
      }),
  },
  {
    name: "בקשת מסמכים מזכיין",
    code: "franchisee_request",
    category: "franchisee_request",
    description: "בקשת מסמכים מזכיין לתקופת התחשבנות",
    subject: "בקשת מסמכים לתקופה {{period}}",
    variables: ["entity_name", "period", "upload_link", "deadline", "brand_name"],
    render: () =>
      FranchiseeRequestEmail({
        entity_name: "{{entity_name}}",
        period: "{{period}}",
        upload_link: "{{upload_link}}",
        deadline: "{{deadline}}",
        brand_name: "{{brand_name}}",
      }),
  },
  {
    name: "בקשת קובץ מבנה אחיד (BKMV)",
    code: "bkmv_request",
    category: "franchisee_request",
    description: "בקשת קובץ BKMV מרואה חשבון של זכיין",
    subject: "בקשת קובץ מבנה אחיד BKMV - {{franchisee_name}}",
    variables: ["start_date", "upload_link", "franchisee_name"],
    render: () =>
      BkmvRequestEmail({
        start_date: "{{start_date}}",
        upload_link: "{{upload_link}}",
        franchisee_name: "{{franchisee_name}}",
      }),
  },
  {
    name: "בקשת קובץ כללית",
    code: "file_request",
    category: "file_request",
    description: "בקשת העלאת קובץ כללית - תומך גם במצב תזכורת",
    subject: "בקשת קובץ: {{document_type}} - {{entity_name}}",
    variables: ["recipient_name", "entity_name", "document_type", "upload_link", "due_date", "description", "brand_name", "is_reminder"],
    render: () =>
      FileRequestEmail({
        recipient_name: "{{recipient_name}}",
        entity_name: "{{entity_name}}",
        document_type: "{{document_type}}",
        upload_link: "{{upload_link}}",
        due_date: "{{due_date}}",
        description: "{{description}}",
        brand_name: "{{brand_name}}",
        is_reminder: "",
      }),
  },
  {
    name: "תזכורת דחופה",
    code: "reminder",
    category: "reminder",
    description: "תזכורת דחופה להגשת מסמכים - כולל באנר אדום",
    subject: "תזכורת: הגשת מסמכים לתקופה {{period}}",
    variables: ["entity_name", "period", "upload_link", "deadline", "brand_name"],
    render: () =>
      ReminderEmail({
        entity_name: "{{entity_name}}",
        period: "{{period}}",
        upload_link: "{{upload_link}}",
        deadline: "{{deadline}}",
        brand_name: "{{brand_name}}",
      }),
  },
  {
    name: "הודעת העלאת קובץ",
    code: "upload_notification",
    category: "custom",
    description: "הודעה פנימית לרעות כשקובץ הועלה למערכת",
    subject: "קובץ חדש הועלה: {{file_name}} - {{entity_name}}",
    variables: ["entity_name", "entity_type", "file_name", "file_size", "uploader_email", "upload_date", "process_link", "brand_name"],
    render: () =>
      UploadNotificationEmail({
        entity_name: "{{entity_name}}",
        entity_type: "{{entity_type}}",
        file_name: "{{file_name}}",
        file_size: "{{file_size}}",
        uploader_email: "{{uploader_email}}",
        upload_date: "{{upload_date}}",
        process_link: "{{process_link}}",
        brand_name: "{{brand_name}}",
      }),
  },
  {
    name: "אסקלציה - ספק לא העלה דוח",
    code: "admin_escalation",
    category: "custom",
    description: "התראה פנימית כשספק לא מגיב אחרי תזכורות",
    subject: "התראה: הספק {{supplier_name}} לא העלה דוח",
    variables: ["supplier_name", "period", "original_sent_date", "reminders_sent"],
    render: () =>
      AdminEscalationEmail({
        supplier_name: "{{supplier_name}}",
        period: "{{period}}",
        original_sent_date: "{{original_sent_date}}",
        reminders_sent: "{{reminders_sent}}",
      }),
  },
  {
    name: "אסקלציה - BKMV לבעל זכיין",
    code: "bkmv_owner_escalation",
    category: "custom",
    description: 'אסקלציה לבעל זכיין כשרו"ח לא מעלה קובץ BKMV',
    subject: "תזכורת: קובץ מבנה אחיד BKMV טרם הועלה - {{franchisee_name}}",
    variables: ["original_sent_date", "start_date", "upload_link", "franchisee_name"],
    render: () =>
      BkmvOwnerEscalationEmail({
        original_sent_date: "{{original_sent_date}}",
        start_date: "{{start_date}}",
        upload_link: "{{upload_link}}",
        franchisee_name: "{{franchisee_name}}",
      }),
  },
  {
    name: "תזכורת תפוגת הסכם",
    code: "agreement_expiry",
    category: "reminder",
    description: "התראה פנימית על תפוגת חוזה שכירות או הסכם זכיינות",
    subject: "תזכורת: תפוגת {{reminder_type}} - {{franchisee_name}}",
    variables: ["franchisee_name", "expiry_date", "advance_notice_days", "reminder_type", "days_remaining"],
    render: () =>
      AgreementExpiryEmail({
        franchisee_name: "{{franchisee_name}}",
        expiry_date: "{{expiry_date}}",
        advance_notice_days: "{{advance_notice_days}}",
        reminder_type: "{{reminder_type}}",
        days_remaining: "{{days_remaining}}",
      }),
  },
];

async function seedTemplates() {
  console.log("🌱 Seeding email templates into database...\n");

  let created = 0;
  let skipped = 0;

  for (const template of SEED_TEMPLATES) {
    // Check if template code already exists
    const existing = await database
      .select({ id: emailTemplate.id })
      .from(emailTemplate)
      .where(eq(emailTemplate.code, template.code))
      .limit(1);

    if (existing.length > 0) {
      console.log(`  ⏭  ${template.code} — already exists, skipping`);
      skipped++;
      continue;
    }

    // Render React Email component to HTML
    const element = template.render();
    const html = await render(element);
    const text = await render(element, { plainText: true });

    await database.insert(emailTemplate).values({
      id: randomUUID(),
      name: template.name,
      code: template.code,
      subject: template.subject,
      bodyHtml: html,
      bodyText: text,
      description: template.description,
      category: template.category,
      variables: template.variables,
      isActive: true,
    });

    console.log(`  ✅ ${template.code} — created`);
    created++;
  }

  console.log(`\n✨ Done! Created ${created}, skipped ${skipped} (total: ${SEED_TEMPLATES.length})`);
  process.exit(0);
}

seedTemplates().catch((err) => {
  console.error("❌ Seed failed:", err);
  process.exit(1);
});
