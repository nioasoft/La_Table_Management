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
import { and, eq, isNull, sql } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

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
    .where(isNull(reconciliationSession.archivedAt));

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
      await database.insert(reconciliationComparison).values(
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
    }
  }

  console.log(
    `\n${APPLY ? "Inserted" : "Would insert"} ${totalMissing} rows across ${sessions.length} live sessions.`
  );
  if (!APPLY && totalMissing > 0) console.log("Re-run with --apply to write.");

  // Session stat counters must follow the new rows or the header lies.
  if (APPLY) {
    await database.execute(
      sql`UPDATE reconciliation_session s SET
         total_franchisees = c.total,
         matched_count = c.matched,
         needs_review_count = c.needs_review
       FROM (
         SELECT session_id,
                COUNT(*) AS total,
                COUNT(*) FILTER (WHERE status IN ('auto_approved','manually_approved')) AS matched,
                COUNT(*) FILTER (WHERE status = 'needs_review') AS needs_review
         FROM reconciliation_comparison GROUP BY session_id
       ) c
       WHERE c.session_id = s.id AND s.archived_at IS NULL`
    );
    console.log("Session counters recalculated.");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
