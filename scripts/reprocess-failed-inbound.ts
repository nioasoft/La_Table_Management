/**
 * Bulk-reprocess failed inbound-email rows from gmail_sync_log.
 *
 * Filters by client_code and a since-date, then drives each email through
 * scripts/reprocess-inbound-email.ts's flow. Idempotent — already-ingested
 * emails are skipped via processClientDocument's gmailMessageId dedup.
 *
 * Usage:
 *   npx tsx scripts/reprocess-failed-inbound.ts --client=CIBUS --since=2026-05-01 --dry-run
 *   npx tsx scripts/reprocess-failed-inbound.ts --client=TENBIS --since=2026-05-01 --apply
 *   npx tsx scripts/reprocess-failed-inbound.ts --emails=d8eb85a0-...,b486654e-... --apply
 *
 * Flags:
 *   --client=<CODE>     One of CIBUS/TENBIS/HAAT/WOLT/MISHLOHA. Required
 *                       unless --emails is given.
 *   --since=YYYY-MM-DD  Lower bound on run_started_at. Default: 7 days ago.
 *   --emails=<id,id>    Comma-separated gmail_sync_log IDs (overrides
 *                       client/since filtering).
 *   --dry-run           Default. Lists what would be re-triggered.
 *   --apply             Actually re-triggers each email.
 */
import "dotenv/config";
import { database } from "../src/db";
import { gmailSyncLog } from "../src/db/schema";
import { and, desc, eq, gt, inArray, isNotNull } from "drizzle-orm";
import { reprocessEmail } from "./reprocess-inbound-email";

interface Args {
  client?: string;
  since?: Date;
  emails?: string[];
  apply: boolean;
}

function parseArgs(argv: readonly string[]): Args {
  const args: Args = { apply: false };
  for (const raw of argv.slice(2)) {
    if (raw === "--apply") args.apply = true;
    else if (raw === "--dry-run") args.apply = false;
    else if (raw.startsWith("--client=")) args.client = raw.slice("--client=".length).toUpperCase();
    else if (raw.startsWith("--since=")) args.since = new Date(raw.slice("--since=".length));
    else if (raw.startsWith("--emails="))
      args.emails = raw
        .slice("--emails=".length)
        .split(",")
        .map((s) => s.trim())
        .filter(Boolean);
  }
  if (!args.since) {
    const d = new Date();
    d.setDate(d.getDate() - 7);
    args.since = d;
  }
  return args;
}

async function main(): Promise<void> {
  const args = parseArgs(process.argv);

  if (!args.client && (!args.emails || args.emails.length === 0)) {
    console.error(
      "Usage: --client=CODE [--since=YYYY-MM-DD] [--apply]  OR  --emails=id1,id2 [--apply]",
    );
    process.exit(1);
  }

  const conditions = [];
  if (args.emails && args.emails.length > 0) {
    conditions.push(inArray(gmailSyncLog.id, args.emails));
  } else {
    conditions.push(eq(gmailSyncLog.clientCode, args.client!));
    conditions.push(gt(gmailSyncLog.runStartedAt, args.since!));
    conditions.push(gt(gmailSyncLog.errorCount, 0));
    conditions.push(isNotNull(gmailSyncLog.emailId));
  }

  const rows = await database
    .select({
      id: gmailSyncLog.id,
      emailId: gmailSyncLog.emailId,
      clientCode: gmailSyncLog.clientCode,
      subject: gmailSyncLog.subject,
      runStartedAt: gmailSyncLog.runStartedAt,
      errorDetails: gmailSyncLog.errorDetails,
    })
    .from(gmailSyncLog)
    .where(and(...conditions))
    .orderBy(desc(gmailSyncLog.runStartedAt));

  console.log(
    `[reprocess] Found ${rows.length} candidate row(s)${args.apply ? " — APPLYING" : " — dry-run"}`,
  );

  let processed = 0;
  let succeeded = 0;
  let failed = 0;

  for (const row of rows) {
    if (!row.emailId) continue;
    const tag = `${row.id.slice(0, 8)} (${row.clientCode}, ${row.runStartedAt?.toISOString().slice(0, 10)}): ${row.subject}`;
    if (!args.apply) {
      console.log(`  DRY  ${tag}`);
      continue;
    }
    processed++;
    console.log(`\n  RUN  ${tag}`);
    try {
      const r = await reprocessEmail(row.emailId);
      if (r.success) {
        succeeded++;
        console.log(`       → success: created=${r.documentsCreated} skipped=${r.duplicatesSkipped}`);
      } else {
        failed++;
        console.log(`       → failed: ${r.errors.join("; ")}`);
      }
    } catch (err: unknown) {
      failed++;
      const msg = err instanceof Error ? err.message : String(err);
      console.log(`       → exception: ${msg}`);
    }
  }

  console.log(
    `\n[reprocess] done. dry-run=${!args.apply} processed=${processed} succeeded=${succeeded} failed=${failed}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
