/**
 * Public-link uploads never had `uploaded_file.franchisee_id` or the period
 * columns written: the route knows `upload_link.entity_id` and the parsed date
 * range, but only ever stamped them onto the BKMV result JSON. Every consumer
 * that filters `isNotNull(franchisee_id)` — the חסרים dashboard, reconciliation
 * V2, revenue/commission reports, the upload-reminder crons — therefore treated
 * a file the franchisee had genuinely sent as never having arrived.
 *
 * This backfills the columns from the link and from bkmv_processing_result.
 * The route itself is fixed so no new rows land this way.
 *
 * Run:  npx tsx src/scripts/backfill-link-upload-franchisee.ts          (dry run)
 *       npx tsx src/scripts/backfill-link-upload-franchisee.ts --apply
 */
import "dotenv/config";
import { database, pool } from "../db";
import { franchisee, uploadLink, uploadedFile } from "../db/schema";
import { and, eq, isNull, isNotNull } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

async function main() {
  const rows = await database
    .select({
      fileId: uploadedFile.id,
      fileName: uploadedFile.originalFileName,
      createdAt: uploadedFile.createdAt,
      status: uploadedFile.processingStatus,
      periodStartDate: uploadedFile.periodStartDate,
      periodEndDate: uploadedFile.periodEndDate,
      bkmv: uploadedFile.bkmvProcessingResult,
      entityType: uploadLink.entityType,
      entityId: uploadLink.entityId,
      franchiseeName: franchisee.name,
    })
    .from(uploadedFile)
    .innerJoin(uploadLink, eq(uploadedFile.uploadLinkId, uploadLink.id))
    .leftJoin(franchisee, eq(uploadLink.entityId, franchisee.id))
    .where(
      and(
        isNull(uploadedFile.franchiseeId),
        isNotNull(uploadedFile.uploadLinkId),
        eq(uploadLink.entityType, "franchisee")
      )
    );

  console.log(`Franchisee-link uploads with no franchisee_id: ${rows.length}\n`);

  let stamped = 0;
  let periodsFilled = 0;

  for (const r of rows) {
    // The parsed range lives in the result JSON even though the columns are null
    const range = (r.bkmv as { dateRange?: { startDate?: string; endDate?: string } } | null)
      ?.dateRange;
    const periodStartDate = r.periodStartDate ?? range?.startDate ?? null;
    const periodEndDate = r.periodEndDate ?? range?.endDate ?? null;

    console.log(
      `${r.createdAt.toISOString().slice(0, 16)} | ${r.franchiseeName ?? "(franchisee missing)"} | ${r.fileName} | ${r.status} | period ${periodStartDate ?? "?"}..${periodEndDate ?? "?"}`
    );

    if (!r.franchiseeName) {
      console.log("    !! link entity_id does not resolve to a franchisee — skipped");
      continue;
    }

    if (APPLY) {
      await database
        .update(uploadedFile)
        .set({
          franchiseeId: r.entityId,
          ...(periodStartDate ? { periodStartDate } : {}),
          ...(periodEndDate ? { periodEndDate } : {}),
        })
        .where(eq(uploadedFile.id, r.fileId));
    }

    stamped++;
    if (periodStartDate && periodEndDate) periodsFilled++;
  }

  console.log(
    `\n${APPLY ? "Updated" : "Would update"} ${stamped} rows (${periodsFilled} with a period).`
  );
  if (!APPLY) console.log("Dry run — pass --apply to write.");

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
