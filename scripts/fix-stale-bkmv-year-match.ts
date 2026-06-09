/**
 * One-off: clear a stale/wrong supplier match from the BKMV YEAR archive
 * (franchisee_bkmv_year), which the supplier-matches report reads.
 *
 * Background: the year archive's supplier_matches is DERIVED from
 * monthly_breakdown entries' supplierId (see aggregateSupplierMatchesFromBreakdown).
 * The per-file unmatch script (unmatch-bkmv-name.ts) and the original UI unmatch
 * cleaned the file's processing result but did NOT re-archive the year table, so
 * the report kept showing a phantom amount (e.g. "מור גמל ופנסיה" → יבולי גורמה
 * ₪3,009 for קינג קונג חדרה). This nulls the supplierId for the given bkmvName in
 * the year's monthly_breakdown and re-aggregates supplier_matches.
 *
 * Usage:
 *   npx tsx scripts/fix-stale-bkmv-year-match.ts \
 *     --franchisee <uuid> --year 2026 --name "<bkmvName>" --supplier <uuid> [--dry-run]
 */

import "dotenv/config";
import { and, eq } from "drizzle-orm";
import { database } from "../src/db";
import { franchiseeBkmvYear } from "../src/db/schema";
import { aggregateSupplierMatchesFromBreakdown } from "../src/lib/bkmvdata-parser";
import type { MonthlyBreakdown } from "../src/lib/bkmvdata-parser";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const franchiseeId = arg("--franchisee");
  const yearStr = arg("--year");
  const name = arg("--name");
  const supplierId = arg("--supplier"); // only clear entries currently tagged with this supplier
  const dryRun = process.argv.includes("--dry-run");

  if (!franchiseeId || !yearStr || !name) {
    console.error(
      'Usage: npx tsx scripts/fix-stale-bkmv-year-match.ts --franchisee <uuid> --year <YYYY> --name "<bkmvName>" [--supplier <uuid>] [--dry-run]'
    );
    process.exit(1);
  }
  const year = parseInt(yearStr, 10);

  const [row] = await database
    .select()
    .from(franchiseeBkmvYear)
    .where(
      and(
        eq(franchiseeBkmvYear.franchiseeId, franchiseeId),
        eq(franchiseeBkmvYear.year, year)
      )
    )
    .limit(1);

  if (!row) {
    console.error(`No franchisee_bkmv_year row for franchisee=${franchiseeId} year=${year}`);
    process.exit(1);
  }

  const breakdown = (row.monthlyBreakdown as MonthlyBreakdown) || {};
  let cleared = 0;
  let clearedAmount = 0;

  const cleaned: MonthlyBreakdown = {};
  for (const [month, entries] of Object.entries(breakdown)) {
    cleaned[month] = entries.map((e) => {
      const matchesName = e.supplierName === name;
      const matchesSupplier = !supplierId || e.supplierId === supplierId;
      if (matchesName && matchesSupplier && e.supplierId) {
        cleared++;
        clearedAmount += e.amount;
        return { ...e, supplierId: null };
      }
      return e;
    });
  }

  if (cleared === 0) {
    console.log(`No matching entries to clear for name="${name}" supplier=${supplierId ?? "(any)"}.`);
    return;
  }

  const newSupplierMatches = aggregateSupplierMatchesFromBreakdown(cleaned);

  console.log(
    `Will null supplierId on ${cleared} monthly entries (total ₪${Math.round(clearedAmount)}) for "${name}".`
  );

  if (dryRun) {
    console.log("[DRY RUN] No changes written.");
    return;
  }

  await database
    .update(franchiseeBkmvYear)
    .set({
      monthlyBreakdown: cleaned,
      supplierMatches: newSupplierMatches,
      updatedAt: new Date(),
    })
    .where(eq(franchiseeBkmvYear.id, row.id));

  console.log(`✅ Cleaned year archive for franchisee=${franchiseeId} year=${year}.`);
}

main()
  .then(() => process.exit(0))
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
