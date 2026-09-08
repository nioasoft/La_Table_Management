/**
 * Send a test supplier file request email
 * Run with: npx tsx src/scripts/send-test-supplier-request.ts
 *
 * This script:
 * 1. Creates a supplier_request email template if it doesn't exist
 * 2. Creates a file request for Nespresso supplier
 * 3. Sends the email with an upload link
 */

import "dotenv/config";

// Override to use production URL
process.env.NEXT_PUBLIC_APP_URL = "https://www.latable.co.il";

import { database } from "../db";
import { emailTemplate, supplier } from "../db/schema";
import { eq } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  createFileRequest,
  sendFileRequestEmail,
} from "../data-access/fileRequests";

const NESPRESSO_ID = "7ea5df6f-ac23-4777-947b-9fce2112a1e7";
const TEST_EMAIL = "benatia.asaf@gmail.com";

async function ensureEmailTemplate() {
  // Check if supplier_request template exists
  const existing = await database
    .select()
    .from(emailTemplate)
    .where(eq(emailTemplate.code, "supplier_request"))
    .limit(1);

  if (existing.length > 0) {
    console.log("✓ Email template 'supplier_request' already exists");
    return existing[0].id;
  }

  // Create the template
  const templateId = randomUUID();
  const now = new Date();

  await database.insert(emailTemplate).values({
    id: templateId,
    name: "בקשת דוח מכירות מספק",
    code: "supplier_request",
    subject: "בקשת דוח מכירות - {{period}}",
    bodyHtml: `
      <div dir="rtl" style="font-family: Arial, sans-serif; line-height: 1.6; text-align: right;">
        <h2 style="color: #1a1a1a;">בקשת דוח מכירות</h2>
        <p>שלום {{entity_name}},</p>
        <p>אנו מבקשים בזאת שתגישו את דוח המכירות שלכם עבור {{brand_name}} לתקופה {{period}}.</p>
        <p>נא להגיש את הדוח עד {{deadline}}.</p>
        <div style="text-align: center; margin: 32px 0;">
          <a href="{{upload_link}}" style="background-color: #2563eb; color: white; padding: 12px 24px; text-decoration: none; border-radius: 6px; font-weight: bold;">
            העלה דוח
          </a>
        </div>
        <p>לשאלות או עזרה, אנא פנו למנהל החשבון שלכם.</p>
        <p>בברכה,<br/>צוות מינה טומאי גרופ</p>
      </div>
    `,
    bodyText: `
שלום {{entity_name}},

אנו מבקשים בזאת שתגישו את דוח המכירות שלכם עבור {{brand_name}} לתקופה {{period}}.

נא להגיש את הדוח עד {{deadline}}.

לינק להעלאה: {{upload_link}}

לשאלות או עזרה, אנא פנו למנהל החשבון שלכם.

בברכה,
צוות מינה טומאי גרופ
    `,
    description: "תבנית לבקשת דוחות מכירות מספקים",
    category: "supplier_request",
    variables: ["entity_name", "period", "deadline", "upload_link", "brand_name"],
    isActive: true,
    createdAt: now,
    updatedAt: now,
  });

  console.log("✓ Created email template 'supplier_request'");
  return templateId;
}

async function main() {
  console.log("\n🚀 Sending test supplier file request...\n");

  // Step 1: Ensure email template exists
  const templateId = await ensureEmailTemplate();

  // Step 2: Verify Nespresso supplier exists
  const [nespresso] = await database
    .select()
    .from(supplier)
    .where(eq(supplier.id, NESPRESSO_ID))
    .limit(1);

  if (!nespresso) {
    console.error("❌ Nespresso supplier not found!");
    process.exit(1);
  }

  console.log(`✓ Found supplier: ${nespresso.name} (${nespresso.code})`);

  // Step 3: Create file request and send email
  const deadline = new Date();
  deadline.setDate(deadline.getDate() + 14); // 2 weeks from now

  // Format date as YYYY-MM-DD for database
  const formatDateForDb = (date: Date) => {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");
    return `${year}-${month}-${day}`;
  };

  // Format date in Hebrew for display
  const formatDateForDisplay = (date: Date) => {
    return date.toLocaleDateString("he-IL", {
      year: "numeric",
      month: "long",
      day: "numeric",
    });
  };

  // Step 3a: Create file request (without sending immediately)
  const fileRequest = await createFileRequest({
    entityType: "supplier",
    entityId: NESPRESSO_ID,
    recipientEmail: TEST_EMAIL,
    recipientName: nespresso.name,
    documentType: "דוח מכירות",
    description: "דוח מכירות לתקופת Q4 2024",
    emailTemplateId: templateId,
    dueDate: formatDateForDb(deadline),
    expiryDays: 30,
    sendImmediately: false, // Don't send yet - we'll send manually with custom variables
  });

  console.log(`✓ File request created: ${fileRequest.id}`);
  console.log(`  Upload URL: ${fileRequest.uploadUrl}`);

  // Step 3b: Send email with custom variables
  const emailResult = await sendFileRequestEmail({
    fileRequestId: fileRequest.id,
    templateId: templateId,
    variables: {
      period: "Q4 2024",
      brand_name: "minna tōmei group",
      deadline: formatDateForDisplay(deadline),
    },
  });

  if (!emailResult.success) {
    console.error(`❌ Failed to send email: ${emailResult.error}`);
    process.exit(1);
  }

  console.log("\n✅ File request created and email sent!");
  console.log(`   Request ID: ${fileRequest.id}`);
  console.log(`   Upload URL: ${fileRequest.uploadUrl}`);
  console.log(`   Message ID: ${emailResult.messageId}`);
  console.log(`   Sent to: ${TEST_EMAIL}`);
  console.log(`   Expires: ${fileRequest.expiresAt}`);

  console.log("\n📧 Check your email for the upload link!\n");

  process.exit(0);
}

main().catch((error) => {
  console.error("❌ Error:", error);
  process.exit(1);
});
