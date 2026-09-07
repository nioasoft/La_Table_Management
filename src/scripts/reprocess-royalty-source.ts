/** Replays one stored royalty workbook, the same way the screen's "עבדי מחדש" does. */
import { eq } from "drizzle-orm";

import { database } from "@/db";
import * as schema from "@/db/schema";
import { getDocument } from "@/lib/storage";
import { processRoyaltyRevenueUpload } from "@/lib/royalty-revenue-processor";

async function main(): Promise<void> {
  const sourceFileId = process.argv[2];
  const [row] = await database
    .select({
      fileUrl: schema.uploadedFile.fileUrl,
      fileName: schema.uploadedFile.originalFileName,
      mimeType: schema.uploadedFile.mimeType,
      uploadedByEmail: schema.uploadedFile.uploadedByEmail,
    })
    .from(schema.uploadedFile)
    .where(eq(schema.uploadedFile.id, sourceFileId))
    .limit(1);
  if (!row) throw new Error("source file not found");
  const buffer = await getDocument(row.fileUrl);
  if (!buffer) throw new Error("stored document unreadable");
  const result = await processRoyaltyRevenueUpload({
    buffer,
    fileName: row.fileName,
    mimeType: row.mimeType,
    uploadedByEmail: row.uploadedByEmail ?? "script",
    sourceFileId,
  });
  console.log(JSON.stringify(result, null, 1));
}

void main().then(() => process.exit(0));
