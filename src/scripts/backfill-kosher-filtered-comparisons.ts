/**
 * One-off: add back the 0/0 rows that the kosher filter dropped.
 *
 * Pass 2 of createReconciliationSession used to skip kosher franchisees whenever
 * supplier.is_kosher was false. That flag is an unmaintained default (33 of 41
 * suppliers false) and the premise is wrong in practice — kosher branches buy
 * from "non-kosher" suppliers all the time (ויני חדרה: ₪35,460 from רסטרטו in
 * Q2-2026). The effect was silently missing branches: קינג קונג מוצקין absent
 * from רסטרטו's session while ביג/חורב/כרמיאל/רעננה sat there at 0/0.
 *
 * The filter is gone, but row sets are frozen at build time, so live sessions
 * still miss those branches. This inserts the missing rows as 0-מול-0
 * auto_approved — purely additive, no existing row or approval is touched.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/backfill-kosher-filtered-comparisons.ts          # dry run
 *   dotenv -e .env -- npx tsx src/scripts/backfill-kosher-filtered-comparisons.ts --apply
 *
 * --since=YYYY-MM-DD limits it to sessions built on/after that local date. Used
 * 2026-10-22 after 0300c5d (the opposite, kosher-supplier filter) went live and
 * dropped non-kosher 0/0 rows from sessions built 2026-10-18; without it the run
 * also widened an unrelated June session (יבולי גורמה Q1).
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import {
  franchisee,
  reconciliationComparison,
  reconciliationSession,
  supplier,
  supplierBrand,
} from "@/db/schema";
import { and, eq, gte, isNull, sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");
const SINCE = process.argv.find((a) => a.startsWith("--since="))?.slice("--since=".length);
if (SINCE && !/^\d{4}-\d{2}-\d{2}$/.test(SINCE)) throw new Error(`--since must be YYYY-MM-DD, got ${SINCE}`);

async function main() {
  const sessions = await database
    .select({
      id: reconciliationSession.id,
      supplierId: reconciliationSession.supplierId,
      supplierName: supplier.name,
      periodStart: reconciliationSession.periodStartDate,
      periodEnd: reconciliationSession.periodEndDate,
    })
    .from(reconciliationSession)
    .innerJoin(supplier, eq(supplier.id, reconciliationSession.supplierId))
    .where(
      and(
        isNull(reconciliationSession.archivedAt),
        // Local midnight (no "Z"), so the cut-off is an Israeli date.
        SINCE ? gte(reconciliationSession.createdAt, new Date(`${SINCE}T00:00:00`)) : undefined
      )
    );

  // Same compatibility rule the fixed Pass 2 uses: active + regular + brand.
  const allFranchisees = await database
    .select({ id: franchisee.id, name: franchisee.name, brandId: franchisee.brandId })
    .from(franchisee)
    .where(and(eq(franchisee.isActive, true), eq(franchisee.category, "regular")));

  const brandsBySupplier = new Map<string, Set<string>>();
  for (const row of await database.select().from(supplierBrand)) {
    const set = brandsBySupplier.get(row.supplierId) ?? new Set<string>();
    set.add(row.brandId);
    brandsBySupplier.set(row.supplierId, set);
  }

  let totalMissing = 0;

  for (const session of sessions) {
    const brands = brandsBySupplier.get(session.supplierId);
    // No brand mapping → Pass 2 was skipped entirely; a rebuild is the fix there,
    // not this backfill (self-healing brandIdSet needs the full history query).
    if (!brands || brands.size === 0) continue;

    const existing = new Set(
      (
        await database
          .select({ franchiseeId: reconciliationComparison.franchiseeId })
          .from(reconciliationComparison)
          .where(eq(reconciliationComparison.sessionId, session.id))
      ).map((r) => r.franchiseeId)
    );

    const missing = allFranchisees.filter(
      (f) => f.brandId && brands.has(f.brandId) && !existing.has(f.id)
    );
    if (missing.length === 0) continue;

    totalMissing += missing.length;
    console.log(
      `${session.supplierName} ${session.periodStart}→${session.periodEnd}: +${missing.length} (${missing
        .map((f) => f.name)
        .join(", ")})`
    );

    if (APPLY) {
      // Every added row is auto_approved, so the header counters move by exactly
      // `n` on this session only. A global recount used to rewrite matched_count
      // as auto+manual on every live session — the app counts auto_approved only
      // (recalculateSessionStats), so that inflated ~40 unrelated headers.
      const n = missing.length;
      await database.transaction(async (tx) => {
        await tx.insert(reconciliationComparison).values(
          missing.map((f) => ({
            sessionId: session.id,
            franchiseeId: f.id,
            supplierAmount: "0",
            franchiseeAmount: "0",
            difference: "0",
            absoluteDifference: "0",
            supplierOriginalName: "",
            status: "auto_approved" as const,
          }))
        );
        await tx
          .update(reconciliationSession)
          .set({
            totalFranchisees: sql`${reconciliationSession.totalFranchisees} + ${n}`,
            matchedCount: sql`${reconciliationSession.matchedCount} + ${n}`,
            approvedCount: sql`${reconciliationSession.approvedCount} + ${n}`,
          })
          .where(eq(reconciliationSession.id, session.id));
      });
    }
  }

  console.log(
    `\n${APPLY ? "Inserted" : "Would insert"} ${totalMissing} rows across ${sessions.length} live sessions.`
  );
  if (!APPLY && totalMissing > 0) console.log("Re-run with --apply to write.");
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
