import fs from "node:fs";
import path from "node:path";
import { eq, like } from "drizzle-orm";

import { createFranchiseeBillingOperations } from "@/data-access/franchisee-billing";
import { updateBillingDiscount } from "@/data-access/franchisee-billing-screen";
import { processRoyaltyRevenueUpload } from "@/lib/royalty-revenue-processor";
import { parseRoyaltyRevenueFile } from "@/lib/client-parsers/royalty-revenue-parser";
import { database } from "@/db";
import { franchisee, franchiseeBilling, uploadedFile } from "@/db/schema";

const XLSX_MIME =
  "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet";

/**
 * Sandbox seeding. Identical to the real ingestion except that the source file
 * is recorded locally instead of being pushed to blob storage, so nothing
 * leaves this machine.
 */
async function main() {
  const dir = process.argv[2];
  const base = await createFranchiseeBillingOperations();
  const operations = {
    ...base,
    persistSourceFile: async (input: Parameters<typeof base.persistSourceFile>[0]) => {
      const id = crypto.randomUUID();
      const endDay = new Date(input.period.year, input.period.month, 0).getDate();
      const pad = (value: number) => String(value).padStart(2, "0");
      await database.insert(uploadedFile).values({
        id,
        uploadLinkId: null,
        fileName: input.fileName,
        originalFileName: input.fileName,
        fileUrl: `sandbox://${input.fileName}`,
        fileSize: input.buffer.length,
        mimeType: input.mimeType,
        uploadedByEmail: input.uploadedByEmail,
        processingStatus: "processing",
        periodStartDate: `${input.period.year}-${pad(input.period.month)}-01`,
        periodEndDate: `${input.period.year}-${pad(input.period.month)}-${pad(endDay)}`,
        metadata: { documentType: "franchisee_royalty_revenue" },
      });
      return id;
    },
  };

  for (const fileName of fs.readdirSync(dir).filter((f) => f.endsWith(".xlsx"))) {
    const result = await processRoyaltyRevenueUpload(
      {
        buffer: fs.readFileSync(path.join(dir, fileName)),
        fileName,
        mimeType: XLSX_MIME,
        uploadedByEmail: "sandbox@localhost",
      },
      { operations, parseRevenue: parseRoyaltyRevenueFile },
    );
    console.log(
      `${fileName}: success=${result.success} drafts=${result.review?.draftsWritten ?? 0} anomalies=${result.review?.anomalies.length ?? 0}`,
    );
    for (const item of result.review?.anomalies ?? []) console.log("   !", item.message);
    for (const error of result.errors ?? []) console.log("   E", error);
  }

  const [row] = await database
    .select({ id: franchiseeBilling.id })
    .from(franchiseeBilling)
    .innerJoin(franchisee, eq(franchiseeBilling.franchiseeId, franchisee.id))
    .where(like(franchisee.name, "ויני חדרה%"))
    .limit(1);
  if (row) {
    const outcome = await updateBillingDiscount(row.id, 1);
    console.log("deferral:", JSON.stringify(outcome).slice(0, 100));
  }
  process.exit(0);
}
void main();
