/**
 * One-off CLI: delete client_document rows that are 10bis "הודעת תשלום"
 * payment notifications mistakenly saved as needs_review by the older
 * tenbis-parser (which only recognised monthly reports).
 *
 * From 2026-05-10 the parser+processor reject these upstream via the
 * `skipPersist` flag, so this script only addresses the historical rows.
 *
 * Selection rule:
 *   - clientId = TENBIS
 *   - processing_status = 'needs_review'
 *   - processing_result.errors contains "לא נמצאו סכומים בדוח תן-ביס"
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/cleanup-tenbis-payment-notifications.ts [--apply]
 *
 * Default is dry-run. Pass --apply to actually delete.
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { clientDocument, franchisee } from "@/db/schema";
import { and, eq, inArray, sql } from "drizzle-orm";

const TENBIS_CLIENT_ID = "e900ca05-41c9-4ef5-b060-ec42a9e6c1ee";

async function main() {
  const apply = process.argv.includes("--apply");

  const targets = await database
    .select({
      id: clientDocument.id,
      franchiseeId: clientDocument.franchiseeId,
      franchiseeName: franchisee.name,
      periodMonth: clientDocument.periodMonth,
      periodYear: clientDocument.periodYear,
      originalFileName: clientDocument.originalFileName,
    })
    .from(clientDocument)
    .leftJoin(franchisee, eq(franchisee.id, clientDocument.franchiseeId))
    .where(
      and(
        eq(clientDocument.clientId, TENBIS_CLIENT_ID),
        eq(clientDocument.processingStatus, "needs_review"),
        sql`${clientDocument.processingResult}->'errors' @> '["לא נמצאו סכומים בדוח תן-ביס"]'::jsonb`
      )
    );

  if (targets.length === 0) {
    console.log("No payment-notification rows found. Nothing to do.");
    return;
  }

  console.log(`Found ${targets.length} payment-notification row(s):`);
  for (const t of targets) {
    console.log(
      `  - ${t.id}  ${t.franchiseeName ?? "?"}  ${t.periodMonth}/${t.periodYear}`
    );
  }

  if (!apply) {
    console.log("\nDry-run. Pass --apply to delete.");
    return;
  }

  // Note: blob files are left in place — they're tiny (~40KB) and orphan
  // blobs don't break anything. Cleanup via storage admin if needed.
  await database
    .delete(clientDocument)
    .where(
      inArray(
        clientDocument.id,
        targets.map((t) => t.id)
      )
    );

  console.log(`\nDeleted ${targets.length} row(s).`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
