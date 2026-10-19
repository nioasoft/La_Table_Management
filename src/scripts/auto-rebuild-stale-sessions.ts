/**
 * Rebuild every live stale reconciliation session that holds no human work —
 * the same pass the nightly build-reconciliation-sessions cron runs, on demand
 * (backfill for sessions that went stale before auto-rebuild existed).
 *
 * Usage:
 *   npx tsx src/scripts/auto-rebuild-stale-sessions.ts           # dry-run
 *   npx tsx src/scripts/auto-rebuild-stale-sessions.ts --apply   # write
 */

import "dotenv/config";
import {
  autoRebuildStaleSessions,
  getAutomationUserId,
} from "@/data-access/reconciliation-auto-rebuild";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const userId = await getAutomationUserId();
  if (!userId) throw new Error("no active admin user to attribute the rebuild to");

  const report = await autoRebuildStaleSessions("all", userId, { dryRun: !apply });
  const reasons = new Map<string, number>();
  for (const k of report.kept) {
    const key = k.reason.replace(/^\d+ /, "N ");
    reasons.set(key, (reasons.get(key) ?? 0) + 1);
  }

  console.log(`${apply ? "REBUILT" : "WOULD rebuild"}: ${report.rebuilt.length}`);
  for (const r of report.rebuilt) console.log(`  ${r.from} → ${r.to}`);
  console.log(`kept (human work): ${report.kept.length}`, Object.fromEntries(reasons));
  if (report.failed.length) console.log("FAILED:", report.failed);
  process.exit(report.failed.length ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
