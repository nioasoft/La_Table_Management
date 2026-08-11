/**
 * One-off CLI: clear 10bis "הודעת תשלום" remittance advices out of the
 * inbound review queue.
 *
 * These are payment advices — they list which invoices a transfer settles and
 * carry no transaction data, so `tenbis-parser.ts` deliberately refuses to
 * persist them (`skipPersist`). Nothing was ever written for them and nothing
 * is lost by removing the rows.
 *
 * They were nevertheless filed as `failed` with the reason "processing
 * failed", because the review-queue writer keyed on `success && document` and
 * a deliberate skip returns success with no document. On 2026-08-10 alone
 * that put 16 of them on the board Reut reads to find real problems — and
 * gmail_sync_log counted each as a created document.
 *
 * The cause is fixed in `email-inbound/route.ts` (same change set), so this
 * only clears the backlog.
 *
 * Also of note: these now arrive from `takeaway@myworkday.com` rather than
 * `no-reply@10bis.co.il`, with UTF-8 filenames mis-decoded as Latin-1
 * ("333405_465960_×§×× ×..."). Neither affects the drop decision — the parser
 * matches on the document text.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/cleanup-tenbis-payment-advice-queue.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { inboundReviewQueue } from "@/db/schema";
import { and, eq, like, sql } from "drizzle-orm";

async function main() {
  const apply = process.argv.includes("--apply");

  const rows = await database
    .select({
      id: inboundReviewQueue.id,
      createdAt: inboundReviewQueue.createdAt,
      subject: inboundReviewQueue.emailSubject,
      status: inboundReviewQueue.status,
      committed: inboundReviewQueue.committedClientDocumentId,
    })
    .from(inboundReviewQueue)
    .where(
      and(
        eq(inboundReviewQueue.clientCode, "TENBIS"),
        like(inboundReviewQueue.emailSubject, "%הודעת תשלום%"),
      ),
    );

  if (rows.length === 0) {
    console.log("✓ no payment-advice rows in the queue.");
    process.exit(0);
  }

  // Safety: a row that actually committed a document is NOT a payment advice
  // we can drop — something else is going on and it needs a human.
  const committed = rows.filter((r) => r.committed !== null);
  if (committed.length > 0) {
    console.error(
      `✗ ${committed.length} row(s) have a committed client_document — refusing to delete. Inspect: ${committed
        .map((r) => r.id)
        .join(", ")}`,
    );
    process.exit(1);
  }

  const byStatus = new Map<string, number>();
  for (const r of rows) byStatus.set(r.status, (byStatus.get(r.status) ?? 0) + 1);

  console.log(`${rows.length} payment-advice row(s) in the queue:`);
  for (const [status, n] of byStatus) console.log(`  ${status}: ${n}`);
  console.log(
    `  date range: ${rows[0]?.createdAt?.toISOString().slice(0, 10)} … ${rows[rows.length - 1]?.createdAt?.toISOString().slice(0, 10)}`,
  );

  if (!apply) {
    console.log("\n(dry run — re-run with --apply to delete)");
    process.exit(0);
  }

  const deleted = await database
    .delete(inboundReviewQueue)
    .where(
      and(
        eq(inboundReviewQueue.clientCode, "TENBIS"),
        like(inboundReviewQueue.emailSubject, "%הודעת תשלום%"),
        sql`${inboundReviewQueue.committedClientDocumentId} is null`,
      ),
    )
    .returning({ id: inboundReviewQueue.id });

  console.log(`\n✓ deleted ${deleted.length} row(s).`);
  process.exit(0);
}

main();
