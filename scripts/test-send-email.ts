import { createFileRequest } from "@/data-access/fileRequests";
import { getEmailTemplateByCode } from "@/data-access/emailTemplates";

// Ensure correct URL when running locally
process.env.NEXT_PUBLIC_APP_URL = "https://www.latable.co.il";

async function main() {
  const template = await getEmailTemplateByCode("supplier_request");
  if (!template) {
    console.error("Template not found");
    process.exit(1);
  }

  console.log("Using template:", template.id, template.name);

  const result = await createFileRequest({
    entityType: "supplier",
    entityId: "7ea5df6f-ac23-4777-947b-9fce2112a1e7", // נספרסו
    documentType: "settlement_report",
    description: "דוח עמלות רשת עבור רבעון 1/2026",
    recipientEmail: "benatia.asaf@gmail.com",
    recipientName: "אסף (בדיקה)",
    emailTemplateId: template.id,
    sendImmediately: true,
    maxFiles: 1,
    metadata: {
      settlementFrequency: "quarterly",
      periodDescription: "רבעון 1/2026",
      brandNames: "מינה טומיי / קינג קונג / ויני",
      requestedAt: new Date().toISOString(),
      cronTriggered: false,
      testEmail: true,
    },
  });

  console.log("File request created:", result.id);
  console.log("Done!");
  process.exit(0);
}

main().catch((err) => {
  console.error("Error:", err);
  process.exit(1);
});
