/**
 * One-off CLI: backfill missing supplier_brand mappings from historical activity.
 *
 * For each (supplier, brand) pair that has historical evidence — either a
 * confirmed franchiseeMatch in supplier_file_upload.processing_result or a
 * supplier reference inside franchisee_bkmv_year.supplier_matches — but no
 * row in supplier_brand, insert the mapping.
 *
 * This complements the runtime self-healing in reconciliation-v2.ts, so the
 * declared mapping stays consistent with the data.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/backfill-supplier-brand-from-history.ts [--dry-run]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { supplierBrand } from "@/db/schema";
import { sql } from "drizzle-orm";

type Pair = {
  supplier_id: string;
  brand_id: string;
  supplier_name: string;
  brand_name: string;
  source: string;
};

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const result = await database.execute<Pair>(sql`
    WITH from_files AS (
      SELECT DISTINCT sfu.supplier_id, f.brand_id
      FROM supplier_file_upload sfu,
           jsonb_array_elements(sfu.processing_result -> 'franchiseeMatches') AS m
      JOIN franchisee f ON f.id = (m ->> 'matchedFranchiseeId')
      WHERE sfu.processing_status <> 'rejected'
        AND m ->> 'matchedFranchiseeId' IS NOT NULL
        AND m ->> 'matchedFranchiseeId' != ''
        AND COALESCE(m ->> 'matchType', '') NOT IN ('blacklisted', 'fuzzy', 'none')
    ),
    from_bkmv AS (
      SELECT DISTINCT (sm ->> 'matchedSupplierId')::text AS supplier_id, f.brand_id
      FROM franchisee_bkmv_year fby
      JOIN franchisee f ON f.id = fby.franchisee_id,
           jsonb_array_elements(fby.supplier_matches) AS sm
      WHERE sm ->> 'matchedSupplierId' IS NOT NULL
        AND sm ->> 'matchedSupplierId' != ''
    ),
    combined AS (
      SELECT supplier_id, brand_id, 'file' AS source FROM from_files
      UNION
      SELECT supplier_id, brand_id, 'bkmv' AS source FROM from_bkmv
    ),
    missing AS (
      SELECT c.supplier_id, c.brand_id, MIN(c.source) AS source
      FROM combined c
      LEFT JOIN supplier_brand sb
        ON sb.supplier_id = c.supplier_id AND sb.brand_id = c.brand_id
      JOIN supplier s ON s.id = c.supplier_id
      JOIN brand b ON b.id = c.brand_id
      WHERE sb.id IS NULL
      GROUP BY c.supplier_id, c.brand_id
    )
    SELECT m.supplier_id, m.brand_id, s.name AS supplier_name, b.name_he AS brand_name, m.source
    FROM missing m
    JOIN supplier s ON s.id = m.supplier_id
    JOIN brand b ON b.id = m.brand_id
    ORDER BY s.name, b.name_he
  `);

  const missingPairs = result.rows;

  if (missingPairs.length === 0) {
    console.log("No missing supplier_brand mappings. supplier_brand is in sync with historical activity.");
    process.exit(0);
  }

  console.log(`Found ${missingPairs.length} missing supplier_brand pair(s):\n`);
  for (const p of missingPairs) {
    console.log(`  ${p.supplier_name.padEnd(30)} -> ${p.brand_name.padEnd(20)} [${p.source}]`);
  }
  console.log();

  if (dryRun) {
    console.log("DRY RUN: no rows inserted. Re-run without --dry-run to apply.");
    process.exit(0);
  }

  let inserted = 0;
  for (const p of missingPairs) {
    try {
      await database
        .insert(supplierBrand)
        .values({ id: crypto.randomUUID(), supplierId: p.supplier_id, brandId: p.brand_id })
        .onConflictDoNothing();
      inserted++;
    } catch (err) {
      const e = err as { message?: string };
      console.error(`  FAILED ${p.supplier_name} -> ${p.brand_name}: ${e?.message ?? String(err)}`);
    }
  }

  console.log(`\nInserted ${inserted}/${missingPairs.length} supplier_brand row(s).`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
