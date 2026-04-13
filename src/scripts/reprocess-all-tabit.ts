/**
 * Re-process every existing Tabit file in the system. Used after changing the
 * client tabitColumnNames mapping, so the stored amounts reflect the new
 * mapping.
 *
 * Strategy: for each distinct (periodMonth, periodYear, original_file_name,
 * file_url) tuple in `client_document` with documentType='tabit_report',
 * download the file from blob storage and run processTabitUpload() on it.
 * Files are processed in ascending upload order so that the last-uploaded file
 * for a given period remains authoritative (matches normal system behavior).
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/reprocess-all-tabit.ts
 */

import { database } from "@/db";
import { clientDocument } from "@/db/schema";
import { eq, asc } from "drizzle-orm";
import { processTabitUpload } from "@/lib/client-document-processor";

async function main() {
  // One "file" might have produced many client_document rows — dedupe by URL.
  const allTabitDocs = await database
    .select({
      fileUrl: clientDocument.fileUrl,
      originalFileName: clientDocument.originalFileName,
      mimeType: clientDocument.mimeType,
      periodMonth: clientDocument.periodMonth,
      periodYear: clientDocument.periodYear,
      createdAt: clientDocument.createdAt,
    })
    .from(clientDocument)
    .where(eq(clientDocument.documentType, "tabit_report"))
    .orderBy(asc(clientDocument.createdAt));

  const seen = new Set<string>();
  const uniqueFiles: typeof allTabitDocs = [];
  for (const d of allTabitDocs) {
    if (!d.fileUrl || seen.has(d.fileUrl)) continue;
    seen.add(d.fileUrl);
    uniqueFiles.push(d);
  }

  console.log(`Found ${uniqueFiles.length} unique Tabit files to re-process.`);

  for (const [i, file] of uniqueFiles.entries()) {
    console.log(
      `\n[${i + 1}/${uniqueFiles.length}] ${file.originalFileName} (${file.periodYear}-${String(file.periodMonth).padStart(2, "0")})`
    );
    if (!file.fileUrl) continue;

    try {
      const res = await fetch(file.fileUrl);
      if (!res.ok) {
        console.error(`  ✗ fetch failed: ${res.status} ${res.statusText}`);
        continue;
      }
      const buffer = Buffer.from(await res.arrayBuffer());

      const result = await processTabitUpload({
        buffer,
        fileName: file.originalFileName,
        mimeType:
          file.mimeType ??
          "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
        source: "manual_upload",
        periodMonth: file.periodMonth,
        periodYear: file.periodYear,
      });

      if (result.success && result.summary) {
        const s = result.summary;
        console.log(
          `  ✓ created=${s.documentsCreated} updated=${s.documentsUpdated} skipped0=${s.skippedZeroAmounts} occClients=${s.occasionalClientsCreated ?? 0} occDocs=${s.occasionalDocumentsCreated ?? 0}`
        );
        if (s.unmatchedBranches.length > 0) {
          console.log(`  unmatchedBranches: ${s.unmatchedBranches.join(", ")}`);
        }
        if (s.unmappedColumns.length > 0) {
          console.log(`  unmappedColumns: ${s.unmappedColumns.join(", ")}`);
        }
      } else {
        console.error(`  ✗ error: ${result.error}`);
      }
    } catch (err) {
      console.error(
        `  ✗ exception: ${err instanceof Error ? err.message : err}`
      );
    }
  }

  console.log("\nDone.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
