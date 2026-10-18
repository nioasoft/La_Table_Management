/**
 * One-off: bring franchisee_bkmv_year back in line with archive ownership —
 * every month holds what its owner says: the newest live (non-rejected) BKMV
 * file, unless its version of the month is a stray sliver of an older file's
 * (src/lib/bkmvdata/archive-ownership.ts).
 *
 * Found 2026-10-18 while checking that a reject undoes the upload-time archive
 * write. Rejected files had left no trace (all 12 superseded by newer files),
 * but the archive is whole-month last-write-wins and exports carry stray
 * documents dated in other years — a later file's stray month replaced the
 * real one: קינג קונג רעננה Sep 2025 ₪4,255,888 → ₪3,835, Dec 2025
 * ₪5,983,948 → ₪2,485,591; אודון Dec 2025 ₪3,880,556 → ₪44,662. Code now
 * enforces ownership on every write (upsertFromFullBreakdown) and on reject
 * (syncBkmvArchiveForStatusChange); this heals what is already stored.
 *
 * Only months whose AMOUNTS differ are rewritten. Link-only differences are
 * reported and left: there the archive holds a link the owner file's stale
 * match lacks (e.g. a name confirmed in the 5bf1b80 heal after the file was
 * matched), and rebuilding would drop a correct link.
 *
 * Changed months flag overlapping active reconciliation sessions stale →
 * "בנה מחדש" (amounts are frozen at session creation). Not rebuilt here.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/heal-bkmv-archive-ownership.ts          # dry run
 *   dotenv -e .env -- npx tsx src/scripts/heal-bkmv-archive-ownership.ts --apply
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import {
  franchisee,
  franchiseeBkmvYear,
  reconciliationComparison,
  reconciliationSession,
  supplier,
} from "@/db/schema";
import { and, eq, gte, isNull, lte } from "drizzle-orm";
import { getLiveBkmvFiles, rebuildBkmvArchiveMonths } from "@/data-access/bkmv-archive-ownership";
import {
  canonicalArchiveMonths,
  type MonthlyBreakdown,
  type MonthlyBreakdownEntry,
} from "@/lib/bkmvdata-parser";

const APPLY = process.argv.includes("--apply");

const total = (entries: MonthlyBreakdownEntry[] | null | undefined) =>
  Math.round((entries ?? []).reduce((sum, e) => sum + e.amount, 0));
const shekels = (n: number) => `₪${n.toLocaleString("en-US")}`;
const amountsKey = (entries: MonthlyBreakdownEntry[]) =>
  entries.map((e) => `${e.supplierName}|${e.amount}|${e.transactionCount}`).sort().join("\n");

async function main() {
  const years = await database.select().from(franchiseeBkmvYear);
  const names = new Map(
    (await database.select({ id: franchisee.id, name: franchisee.name }).from(franchisee)).map((f) => [f.id, f.name])
  );

  const supplierNames = new Map(
    (await database.select({ id: supplier.id, name: supplier.name }).from(supplier)).map((s) => [s.id, s.name])
  );

  const archiveByFranchisee = new Map<string, MonthlyBreakdown>();
  for (const y of years) {
    archiveByFranchisee.set(y.franchiseeId, {
      ...archiveByFranchisee.get(y.franchiseeId),
      ...(y.monthlyBreakdown as MonthlyBreakdown),
    });
  }

  let amountChanges = 0;
  let linkOnlyChanges = 0;
  const sessionsToFlag = new Set<string>();

  for (const [franchiseeId, archive] of archiveByFranchisee) {
    const live = await getLiveBkmvFiles(franchiseeId);
    const months = [...new Set([...Object.keys(archive), ...live.flatMap((f) => Object.keys(f.monthlyBreakdown))])]
      .filter((m) => /^\d{4}-\d{2}$/.test(m))
      .sort();
    const canonical = canonicalArchiveMonths(live, months);

    const diffs: string[] = [];
    const amountMonths: string[] = [];
    for (const month of months) {
      const before = archive[month];
      const after = canonical[month];
      if (!before && !after) continue;
      if (before && after && amountsKey(before) === amountsKey(after)) {
        const linked = (es: MonthlyBreakdownEntry[]) => es.map((e) => `${e.supplierName}|${e.supplierId}`).sort().join("\n");
        if (linked(before) !== linked(after)) {
          linkOnlyChanges++;
          const was = new Map(before.map((e) => [e.supplierName, e.supplierId]));
          const flips = after
            .filter((e) => was.get(e.supplierName) !== e.supplierId)
            .map((e) => `"${e.supplierName}" ${supplierNames.get(was.get(e.supplierName) ?? "") ?? "—"} → ${supplierNames.get(e.supplierId ?? "") ?? "—"}`);
          diffs.push(`${month}  links only — left as is: ${flips.join("; ")}`);
        }
        continue;
      }
      amountChanges++;
      amountMonths.push(month);
      const kind = !before ? "add" : !after ? "remove (no live file owns it)" : "replace";
      diffs.push(`${month}  ${kind}: ${shekels(total(before))} (${before?.length ?? 0}) → ${shekels(total(after))} (${after?.length ?? 0})`);
    }
    if (diffs.length === 0) continue;

    console.log(`\n${names.get(franchiseeId) ?? franchiseeId}`);
    for (const d of diffs) console.log(`  ${d}`);

    if (amountMonths.length === 0) continue;
    // Compute first, list the not-yet-stale sessions, then write — so --apply
    // reports the sessions it newly flags, not ones already stale.
    const changed = await rebuildBkmvArchiveMonths(franchiseeId, amountMonths, { dryRun: true });
    for (const month of changed) {
      const [y, m] = month.split("-").map(Number);
      const monthEnd = `${month}-${String(new Date(y, m, 0).getDate()).padStart(2, "0")}`;
      const sessions = await database
        .selectDistinct({ id: reconciliationSession.id, supplierName: supplier.name, start: reconciliationSession.periodStartDate, end: reconciliationSession.periodEndDate })
        .from(reconciliationSession)
        .innerJoin(reconciliationComparison, eq(reconciliationComparison.sessionId, reconciliationSession.id))
        .innerJoin(supplier, eq(supplier.id, reconciliationSession.supplierId))
        .where(
          and(
            isNull(reconciliationSession.archivedAt),
            isNull(reconciliationSession.staleAt),
            eq(reconciliationComparison.franchiseeId, franchiseeId),
            lte(reconciliationSession.periodStartDate, monthEnd),
            gte(reconciliationSession.periodEndDate, `${month}-01`)
          )
        );
      for (const s of sessions) {
        if (sessionsToFlag.has(s.id)) continue;
        sessionsToFlag.add(s.id);
        console.log(`    session: ${s.supplierName} ${s.start}→${s.end}`);
      }
    }
    if (APPLY) await rebuildBkmvArchiveMonths(franchiseeId, amountMonths);
  }

  console.log(`\n${amountChanges} month(s) with amount changes, ${linkOnlyChanges} with link-only changes`);
  console.log(`${sessionsToFlag.size} active session(s) ${APPLY ? "flagged stale" : "would be flagged stale"}`);
  if (!APPLY) console.log("Dry run — re-run with --apply to write.");
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
