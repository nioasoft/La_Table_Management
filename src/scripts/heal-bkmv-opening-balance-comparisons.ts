/**
 * Second half of the opening-balance heal: refresh the frozen franchisee
 * amounts on reconciliation comparisons that were built from the polluted
 * January data.
 *
 * `heal-bkmv-opening-balance.ts` fixes `franchisee_bkmv_year`, but comparison
 * rows keep the amount captured when their session was created — so the
 * negative January figures stay on screen until each row is refreshed.
 *
 * Scope is deliberately narrow: only the franchisees whose files carried an
 * opening-balance batch, and only sessions whose period overlaps a January.
 * Archived sessions are skipped by `refreshFranchiseeAmount` itself, and manual
 * statuses are preserved there too — only auto rows re-evaluate vs the ₪30
 * threshold.
 *
 *   npx tsx src/scripts/heal-bkmv-opening-balance-comparisons.ts         # dry run
 *   npx tsx src/scripts/heal-bkmv-opening-balance-comparisons.ts --apply
 */
import { database } from "@/db";
import {
  reconciliationComparison,
  reconciliationSession,
  franchisee,
  supplier,
} from "@/db/schema";
import { and, eq, isNull, inArray, sql } from "drizzle-orm";
import { refreshFranchiseeAmount } from "@/data-access/reconciliation-v2";

const APPLY = process.argv.includes("--apply");

/** Franchisees whose BKMV files carried the Jan-1 opening-balance batch. */
const AFFECTED = ["סידיוס בע\"מ", "מיאמוטו בע\"מ", "קינג קונג רעננה"];

async function main() {
  const rows = await database
    .select({
      id: reconciliationComparison.id,
      franchiseeName: franchisee.name,
      supplierName: supplier.name,
      periodStart: reconciliationSession.periodStartDate,
      periodEnd: reconciliationSession.periodEndDate,
      status: reconciliationComparison.status,
      supplierAmount: reconciliationComparison.supplierAmount,
      franchiseeAmount: reconciliationComparison.franchiseeAmount,
      difference: reconciliationComparison.difference,
    })
    .from(reconciliationComparison)
    .innerJoin(
      reconciliationSession,
      eq(reconciliationSession.id, reconciliationComparison.sessionId)
    )
    .innerJoin(franchisee, eq(franchisee.id, reconciliationComparison.franchiseeId))
    .innerJoin(supplier, eq(supplier.id, reconciliationSession.supplierId))
    .where(
      and(
        isNull(reconciliationSession.archivedAt),
        inArray(franchisee.name, AFFECTED),
        // Only periods that actually contain a January — the only month the
        // opening-balance batch could pollute.
        sql`EXISTS (
          SELECT 1 FROM generate_series(
            date_trunc('month', ${reconciliationSession.periodStartDate}::date),
            date_trunc('month', ${reconciliationSession.periodEndDate}::date),
            interval '1 month'
          ) AS m WHERE extract(month FROM m) = 1
        )`
      )
    );

  console.log(`${rows.length} comparison rows in scope\n`);

  let changed = 0;
  const stillOffAfterFix: string[] = [];

  for (const row of rows) {
    const label = `${row.supplierName} / ${row.franchiseeName} ${row.periodStart}→${row.periodEnd}`;

    if (!APPLY) {
      console.log(
        `${label}\n  now: ספק ₪${Number(row.supplierAmount).toLocaleString("he-IL")} | זכיין ₪${Number(row.franchiseeAmount).toLocaleString("he-IL")} | הפרש ₪${Number(row.difference).toLocaleString("he-IL")} | ${row.status}`
      );
      continue;
    }

    const updated = await refreshFranchiseeAmount(row.id);
    if (!updated) {
      console.log(`${label}\n  SKIPPED (archived or missing amounts)`);
      continue;
    }

    const before = Number(row.franchiseeAmount);
    const after = Number(updated.franchiseeAmount);
    if (before === after) continue;

    changed++;
    console.log(
      `${label}\n  זכיין ₪${before.toLocaleString("he-IL")} → ₪${after.toLocaleString("he-IL")} | הפרש ₪${Number(row.difference).toLocaleString("he-IL")} → ₪${Number(updated.difference).toLocaleString("he-IL")} | ${row.status} → ${updated.status}`
    );

    // A manual approval keeps its status by design — flag any that no longer
    // look approvable so a human can re-check them.
    if (
      updated.status === "manually_approved" &&
      Math.abs(Number(updated.difference)) > 30
    ) {
      stillOffAfterFix.push(
        `${label} — הפרש ₪${Math.round(Number(updated.difference)).toLocaleString("he-IL")} אך מסומן "אושר ידנית"`
      );
    }
  }

  console.log(
    `\n${APPLY ? `${changed} rows refreshed` : "dry run — run again with --apply to write"}`
  );

  if (stillOffAfterFix.length) {
    console.log("\n⚠ שורות שאושרו ידנית ועדיין בהפרש — כדאי שרעות תעבור עליהן:");
    for (const s of stillOffAfterFix) console.log(`  ${s}`);
  }
  process.exit(0);
}

main();
