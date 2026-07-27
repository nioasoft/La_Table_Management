/**
 * One-off: clear `stale_at` on reconciliation sessions that were flagged by
 * mistake.
 *
 * Until this run, every מבנה אחיד upload flagged sessions across the file's
 * whole span — and those files are cumulative from January, so each quarterly
 * upload re-flagged every closed period of the year even though Jan–Mar data
 * was byte-identical. ~30 active sessions carry a false "הסשן אינו מעודכן".
 *
 * Verdict per session: recompute the franchisee side from CURRENT data
 * (computeFranchiseeAmountsForSession — the same math the UI refresh uses) and
 * compare with the stored comparison amounts. All equal → the flag was false,
 * clear it. Any row differs → genuinely stale, leave the banner alone.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/clear-false-stale-sessions.ts          # dry run
 *   dotenv -e .env -- npx tsx src/scripts/clear-false-stale-sessions.ts --apply
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import {
  reconciliationSession,
  reconciliationComparison,
  supplier,
  franchisee,
} from "@/db/schema";
import { and, eq, isNull, isNotNull } from "drizzle-orm";
import { computeFranchiseeAmountsForSession } from "@/data-access/reconciliation-v2";

// Rounding tolerance — stored amounts are numeric(…, 2).
const TOLERANCE = 0.01;

const APPLY = process.argv.includes("--apply");

async function main() {
  const sessions = await database
    .select({
      id: reconciliationSession.id,
      supplierId: reconciliationSession.supplierId,
      supplierFileId: reconciliationSession.supplierFileId,
      periodStartDate: reconciliationSession.periodStartDate,
      periodEndDate: reconciliationSession.periodEndDate,
      status: reconciliationSession.status,
      staleAt: reconciliationSession.staleAt,
      supplierName: supplier.name,
    })
    .from(reconciliationSession)
    .innerJoin(supplier, eq(supplier.id, reconciliationSession.supplierId))
    .where(
      and(
        isNull(reconciliationSession.archivedAt),
        isNotNull(reconciliationSession.staleAt)
      )
    )
    .orderBy(reconciliationSession.periodStartDate);

  console.log(
    `${sessions.length} active stale sessions${APPLY ? "" : " (dry run — nothing will be written)"}\n`
  );

  const falseFlagged: string[] = [];
  let genuine = 0;

  for (const sess of sessions) {
    const label = `${sess.supplierName} | ${sess.periodStartDate}..${sess.periodEndDate} | ${sess.status}`;

    const current = await computeFranchiseeAmountsForSession(sess);
    if (!current) {
      console.log(`?  ${label} — supplier missing, skipping`);
      continue;
    }

    const comparisons = await database
      .select({
        franchiseeAmount: reconciliationComparison.franchiseeAmount,
        franchiseeId: reconciliationComparison.franchiseeId,
        franchiseeName: franchisee.name,
      })
      .from(reconciliationComparison)
      .innerJoin(
        franchisee,
        eq(franchisee.id, reconciliationComparison.franchiseeId)
      )
      .where(eq(reconciliationComparison.sessionId, sess.id));

    const drifted = comparisons
      .map((comp) => ({
        name: comp.franchiseeName,
        stored: Number(comp.franchiseeAmount),
        now: current.get(comp.franchiseeId)?.amount ?? 0,
      }))
      .filter((row) => Math.abs(row.stored - row.now) > TOLERANCE);

    if (drifted.length === 0) {
      falseFlagged.push(sess.id);
      console.log(`✓  ${label} — unchanged, flag is false`);
    } else {
      genuine++;
      console.log(`⚠  ${label} — ${drifted.length} rows changed:`);
      for (const row of drifted) {
        console.log(
          `      ${row.name}: ${row.stored.toFixed(2)} → ${row.now.toFixed(2)}`
        );
      }
    }
  }

  console.log(
    `\n${falseFlagged.length} false, ${genuine} genuinely stale, ${sessions.length} total`
  );

  if (!APPLY) {
    console.log("Dry run — re-run with --apply to clear the false flags.");
    process.exit(0);
  }

  for (const id of falseFlagged) {
    await database
      .update(reconciliationSession)
      .set({ staleAt: null, updatedAt: new Date() })
      .where(eq(reconciliationSession.id, id));
  }
  console.log(`Cleared stale_at on ${falseFlagged.length} sessions.`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
