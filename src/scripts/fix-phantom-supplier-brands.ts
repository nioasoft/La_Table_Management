/**
 * One-off: remove branches a supplier never sold to from its reconciliation rows.
 *
 * Reut: "רסטרטו זה ספק שהוא רק של ויני — למה יש פה קינג קונג ומינה טומיי בכלל?"
 * She is right. Two bad evidence sources put them there:
 *
 *   1. A **rejected** `רסטרטו.xlsx` had matched all of קינג קונג + מינה טומיי.
 *      Both the runtime self-heal and backfill-supplier-brand-from-history.ts
 *      read supplier files without filtering on processing_status, so a file
 *      Reut had thrown out still declared which brands the supplier serves.
 *   2. רסטרטו carried `טרז פזוס שיווק בע"מ` — another active supplier's own
 *      name — in bkmv_aliases, so three קינג קונג branches' טרז פזוס purchases
 *      were credited to רסטרטו, which "proved" it serves קינג קונג.
 *
 * Both are fixed in code (rejected files excluded; updateSupplier now refuses a
 * poached alias). This cleans the data they already produced.
 *
 * Only removes rows that are 0-מול-0 and not manually approved — a real amount
 * or a human decision is never touched, it is reported instead.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/fix-phantom-supplier-brands.ts          # dry run
 *   dotenv -e .env -- npx tsx src/scripts/fix-phantom-supplier-brands.ts --apply
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { supplier, supplierBrand, franchiseeBkmvYear } from "@/db/schema";
import { eq, sql } from "drizzle-orm";

type Tx = Parameters<Parameters<typeof database.transaction>[0]>[0];
import { normalizeName } from "@/lib/supplier-matcher";

const APPLY = process.argv.includes("--apply");
const tag = APPLY ? "" : " [dry run]";

async function run(tx: Tx) {
  const suppliers = await tx
    .select({
      id: supplier.id,
      name: supplier.name,
      bkmvAliases: supplier.bkmvAliases,
      isActive: supplier.isActive,
    })
    .from(supplier);

  const byNormalizedName = new Map(
    suppliers.filter((s) => s.isActive).map((s) => [normalizeName(s.name), s])
  );

  // --- 1. Aliases that are another active supplier's own name -------------
  console.log(`\n=== כינויים גזולים${tag} ===`);
  for (const s of suppliers) {
    const aliases = (s.bkmvAliases as string[] | null) ?? [];
    const kept = aliases.filter((a) => {
      const owner = byNormalizedName.get(normalizeName(a));
      return !owner || owner.id === s.id;
    });
    if (kept.length === aliases.length) continue;

    const dropped = aliases.filter((a) => !kept.includes(a));
    console.log(`  ${s.name}: מסיר ${dropped.map((d) => `"${d}"`).join(", ")}`);
    await tx
      .update(supplier)
      .set({ bkmvAliases: kept.length > 0 ? kept : null })
      .where(eq(supplier.id, s.id));
  }

  // --- 2. BKMV matches pointing at the wrong supplier ---------------------
  // Only when the BKMV name IS another supplier's registered name — that is
  // unambiguous. A name owned merely via someone else's alias is reported at
  // the end for a human to decide, since re-pointing it moves real money.
  console.log(`\n=== התאמות BKMV לספק הלא נכון${tag} ===`);
  const bkmvYears = await tx
    .select({
      id: franchiseeBkmvYear.id,
      franchiseeId: franchiseeBkmvYear.franchiseeId,
      year: franchiseeBkmvYear.year,
      supplierMatches: franchiseeBkmvYear.supplierMatches,
    })
    .from(franchiseeBkmvYear);

  const suppliersById = new Map(suppliers.map((s) => [s.id, s]));

  for (const row of bkmvYears) {
    const matches = (row.supplierMatches as Array<Record<string, unknown>> | null) ?? [];
    let changed = false;
    const repointed = matches.map((m) => {
      const currentId = m.matchedSupplierId as string | null;
      if (!currentId) return m;
      const owner = byNormalizedName.get(normalizeName(String(m.bkmvName ?? "")));
      if (!owner || owner.id === currentId) return m;
      console.log(
        `  ${row.year} "${m.bkmvName}" ₪${m.amount}: ` +
          `${suppliersById.get(currentId)?.name ?? currentId} → ${owner.name}`
      );
      changed = true;
      return { ...m, matchedSupplierId: owner.id, matchedSupplierName: owner.name };
    });

    if (changed) {
      // Keep the in-memory copy current — step 2b reads it, and a stale copy
      // would write this repoint straight back out.
      row.supplierMatches = repointed as typeof row.supplierMatches;
      await tx
        .update(franchiseeBkmvYear)
        .set({ supplierMatches: repointed })
        .where(eq(franchiseeBkmvYear.id, row.id));
    }
  }

  // --- 2b. One BKMV name matched to several different suppliers -----------
  // At most one can be right, so none of them is defensible evidence. "ניגא שף
  // בע"מ" (a kitchen-equipment vendor, not a commission supplier) appears in 15
  // franchisee books: left unmatched in 12, and matched to רסטרטו, גרינטי and
  // טי שייפ in the other three. That single ₪1,669 line was the whole reason
  // רסטרטו "served" קינג קונג. Clearing puts them back with the majority.
  console.log(`\n=== שם אחד ששויך לכמה ספקים — מנוקה${tag} ===`);
  const supplierIdsByName = new Map<string, Set<string>>();
  for (const row of bkmvYears) {
    for (const m of ((row.supplierMatches as Array<Record<string, unknown>> | null) ?? [])) {
      const id = m.matchedSupplierId as string | null;
      if (!id) continue;
      const key = normalizeName(String(m.bkmvName ?? ""));
      const set = supplierIdsByName.get(key) ?? new Set<string>();
      set.add(id);
      supplierIdsByName.set(key, set);
    }
  }
  const contradictory = new Set(
    [...supplierIdsByName.entries()].filter(([, ids]) => ids.size > 1).map(([name]) => name)
  );

  for (const row of bkmvYears) {
    const matches = (row.supplierMatches as Array<Record<string, unknown>> | null) ?? [];
    let changed = false;
    const cleared = matches.map((m) => {
      const id = m.matchedSupplierId as string | null;
      if (!id || !contradictory.has(normalizeName(String(m.bkmvName ?? "")))) return m;
      console.log(
        `  ${row.year} "${m.bkmvName}" ₪${m.amount}: מבטל שיוך ל-${suppliersById.get(id)?.name ?? id}`
      );
      changed = true;
      return { ...m, matchedSupplierId: null, matchedSupplierName: null };
    });
    if (changed) {
      await tx
        .update(franchiseeBkmvYear)
        .set({ supplierMatches: cleared })
        .where(eq(franchiseeBkmvYear.id, row.id));
    }
  }

  // --- 3. supplier_brand rows that a rejected file wrote ------------------
  // Now that the declaration is authoritative, deleting one is deleting an
  // answer, so only rows whose ONLY evidence is a rejected file get removed —
  // those are exactly the ones backfill-supplier-brand-from-history.ts created
  // from data Reut had thrown out. A mapping with no evidence at all may be a
  // deliberate "we sell to them, nothing yet this period" and is reported, not
  // touched. Re-derived AFTER steps 1-2b, so it sees the corrected world.
  console.log(`\n=== מיפויים שנוצרו מקובץ שנדחה${tag} ===`);
  const noLiveEvidence = sql`
      NOT EXISTS (
        SELECT 1 FROM supplier_file_upload sfu,
             jsonb_array_elements(sfu.processing_result -> 'franchiseeMatches') m
        JOIN franchisee f ON f.id = (m ->> 'matchedFranchiseeId')
        WHERE sfu.supplier_id = sb.supplier_id
          AND sfu.processing_status <> 'rejected'
          AND f.brand_id = sb.brand_id
          AND COALESCE(m ->> 'matchType', '') NOT IN ('blacklisted', 'fuzzy', 'none')
      )
      AND NOT EXISTS (
        SELECT 1 FROM franchisee_bkmv_year fby
        JOIN franchisee f ON f.id = fby.franchisee_id,
             jsonb_array_elements(fby.supplier_matches) sm
        WHERE sm ->> 'matchedSupplierId' = sb.supplier_id
          AND f.brand_id = sb.brand_id
      )`;
  const fromRejected = sql`
      EXISTS (
        SELECT 1 FROM supplier_file_upload sfu,
             jsonb_array_elements(sfu.processing_result -> 'franchiseeMatches') m
        JOIN franchisee f ON f.id = (m ->> 'matchedFranchiseeId')
        WHERE sfu.supplier_id = sb.supplier_id
          AND sfu.processing_status = 'rejected'
          AND f.brand_id = sb.brand_id
      )`;

  const phantom = await tx.execute<{
    supplier_id: string;
    brand_id: string;
    supplier_name: string;
    brand_name: string;
  }>(sql`
    SELECT sb.supplier_id, sb.brand_id, s.name AS supplier_name, b.name AS brand_name
    FROM supplier_brand sb
    JOIN supplier s ON s.id = sb.supplier_id
    JOIN brand b ON b.id = sb.brand_id
    WHERE s.is_active = true AND ${noLiveEvidence} AND ${fromRejected}
    ORDER BY s.name, b.name
  `);

  for (const p of phantom.rows) {
    console.log(`  ${p.supplier_name} ✗ ${p.brand_name}`);
    await tx
      .delete(supplierBrand)
      .where(
        sql`${supplierBrand.supplierId} = ${p.supplier_id} AND ${supplierBrand.brandId} = ${p.brand_id}`
      );
  }

  const unproven = await tx.execute<{ supplier_name: string; brand_name: string }>(sql`
    SELECT s.name AS supplier_name, b.name AS brand_name
    FROM supplier_brand sb
    JOIN supplier s ON s.id = sb.supplier_id
    JOIN brand b ON b.id = sb.brand_id
    WHERE s.is_active = true AND ${noLiveEvidence}
    ORDER BY s.name, b.name
  `);

  // --- 4. The 0/0 rows those phantom brands created in live sessions ------
  console.log(`\n=== שורות 0/0 שנמחקות מסשנים חיים${tag} ===`);
  // Mirrors createReconciliationSession exactly: a mapped supplier is judged by
  // its mapping alone, and only an unmapped one falls back to history. Testing
  // the union instead would leave behind rows the fixed code no longer builds.
  const orphanFilter = sql`
    c.supplier_amount = 0 AND c.franchisee_amount = 0
    AND c.status <> 'manually_approved'
    AND ses.archived_at IS NULL
    AND NOT EXISTS (
      SELECT 1 FROM supplier_brand sb
      WHERE sb.supplier_id = ses.supplier_id AND sb.brand_id = f.brand_id
    )
    AND (
      EXISTS (SELECT 1 FROM supplier_brand sb WHERE sb.supplier_id = ses.supplier_id)
      OR (
        NOT EXISTS (
          SELECT 1 FROM supplier_file_upload sfu,
               jsonb_array_elements(sfu.processing_result -> 'franchiseeMatches') m
          JOIN franchisee hf ON hf.id = (m ->> 'matchedFranchiseeId')
          WHERE sfu.supplier_id = ses.supplier_id
            AND sfu.processing_status <> 'rejected'
            AND hf.brand_id = f.brand_id
            AND COALESCE(m ->> 'matchType', '') NOT IN ('blacklisted', 'fuzzy', 'none')
        )
        AND NOT EXISTS (
          SELECT 1 FROM franchisee_bkmv_year fby
          JOIN franchisee hf ON hf.id = fby.franchisee_id,
               jsonb_array_elements(fby.supplier_matches) sm
          WHERE sm ->> 'matchedSupplierId' = ses.supplier_id
            AND hf.brand_id = f.brand_id
        )
      )
    )`;

  const orphans = await tx.execute<{
    supplier_name: string;
    franchisee_name: string;
    rows: string;
  }>(sql`
    SELECT s.name AS supplier_name, f.name AS franchisee_name, COUNT(*)::text AS rows
    FROM reconciliation_comparison c
    JOIN reconciliation_session ses ON ses.id = c.session_id
    JOIN supplier s ON s.id = ses.supplier_id
    JOIN franchisee f ON f.id = c.franchisee_id
    WHERE ${orphanFilter}
    GROUP BY 1, 2 ORDER BY 1, 2
  `);
  for (const o of orphans.rows) {
    console.log(`  ${o.supplier_name} — ${o.franchisee_name} (${o.rows} סשנים)`);
  }
  const orphanTotal = orphans.rows.reduce((sum, o) => sum + Number(o.rows), 0);

  if (orphanTotal > 0) {
    await tx.execute(sql`
      DELETE FROM reconciliation_comparison c
      USING reconciliation_session ses, franchisee f
      WHERE ses.id = c.session_id AND f.id = c.franchisee_id AND ${orphanFilter}
    `);
    await tx.execute(sql`
      UPDATE reconciliation_session s SET
        total_franchisees = c.total,
        matched_count = c.matched,
        needs_review_count = c.needs_review
      FROM (
        SELECT session_id, COUNT(*) AS total,
               COUNT(*) FILTER (WHERE status IN ('auto_approved','manually_approved')) AS matched,
               COUNT(*) FILTER (WHERE status = 'needs_review') AS needs_review
        FROM reconciliation_comparison GROUP BY session_id
      ) c
      WHERE c.session_id = s.id AND s.archived_at IS NULL
    `);
    console.log("  מוני הסשנים חושבו מחדש.");
  }

  // --- 5. Report-only: kept rows that look wrong but move real money ------
  console.log("\n=== לבדיקה ידנית (לא נגעתי) ===");
  for (const u of unproven.rows) {
    console.log(
      `  ${u.supplier_name} מסומן על ${u.brand_name} אבל אין שום פעילות — מכוון או סימון בטעות?`
    );
  }

  // The inverse, and the one that matters more now: real activity against a
  // brand nobody checked. Before, history quietly covered for it; with the
  // declaration authoritative, a missing checkbox silently suppresses rows.
  const undeclared = await tx.execute<{
    supplier_name: string;
    brand_name: string;
    source: string;
  }>(sql`
    SELECT s.name AS supplier_name, b.name AS brand_name, src.source
    FROM supplier s
    JOIN LATERAL (
      SELECT DISTINCT f.brand_id, 'קובץ' AS source
      FROM supplier_file_upload sfu,
           jsonb_array_elements(sfu.processing_result -> 'franchiseeMatches') m
      JOIN franchisee f ON f.id = (m ->> 'matchedFranchiseeId')
      WHERE sfu.supplier_id = s.id AND sfu.processing_status <> 'rejected'
        AND COALESCE(m ->> 'matchType', '') NOT IN ('blacklisted', 'fuzzy', 'none')
      UNION
      SELECT DISTINCT f.brand_id, 'BKMV'
      FROM franchisee_bkmv_year fby
      JOIN franchisee f ON f.id = fby.franchisee_id,
           jsonb_array_elements(fby.supplier_matches) sm
      WHERE sm ->> 'matchedSupplierId' = s.id
    ) src ON true
    JOIN brand b ON b.id = src.brand_id
    WHERE s.is_active = true
      AND EXISTS (SELECT 1 FROM supplier_brand sb WHERE sb.supplier_id = s.id)
      AND NOT EXISTS (
        SELECT 1 FROM supplier_brand sb
        WHERE sb.supplier_id = s.id AND sb.brand_id = src.brand_id
      )
    ORDER BY 1, 2
  `);
  for (const u of undeclared.rows) {
    console.log(
      `  ${u.supplier_name}: יש פעילות מול ${u.brand_name} (${u.source}) אבל המותג לא מסומן — ` +
        `הסניפים האלה לא יופיעו יותר כ-0/0`
    );
  }
  const aliasOwned = new Map<string, { supplier: string; aliases: string[] }>();
  for (const s of suppliers) {
    if (!s.isActive) continue;
    for (const a of ((s.bkmvAliases as string[] | null) ?? [])) {
      const key = normalizeName(a);
      if (byNormalizedName.has(key)) continue; // handled above
      const entry = aliasOwned.get(key);
      if (entry) entry.aliases.push(s.name);
      else aliasOwned.set(key, { supplier: s.name, aliases: [s.name] });
    }
  }
  for (const row of bkmvYears) {
    for (const m of ((row.supplierMatches as Array<Record<string, unknown>> | null) ?? [])) {
      const currentId = m.matchedSupplierId as string | null;
      if (!currentId) continue;
      const owner = aliasOwned.get(normalizeName(String(m.bkmvName ?? "")));
      if (!owner || owner.supplier === suppliersById.get(currentId)?.name) continue;
      console.log(
        `  ${row.year} "${m.bkmvName}" ₪${m.amount}: שויך ל-${suppliersById.get(currentId)?.name}` +
          `, אבל השם רשום ככינוי של ${owner.aliases.join(" / ")}`
      );
    }
  }

  console.log(
    `\n${APPLY ? "בוצע" : "יבוצע"}: ${phantom.rows.length} מיפויי מותג, ${orphanTotal} שורות 0/0.`
  );
}

async function main() {
  // Steps 3 and 4 re-query state that steps 1 and 2 change, so a dry run that
  // does not write shows the wrong answer. Everything runs inside one
  // transaction and a dry run rolls it back — the preview is what --apply does.
  const ROLLBACK = "__dry_run_rollback__";
  try {
    await database.transaction(async (tx) => {
      await run(tx);
      if (!APPLY) throw new Error(ROLLBACK);
    });
  } catch (error) {
    if (!(error instanceof Error) || error.message !== ROLLBACK) throw error;
    console.log("להרצה אמיתית: --apply");
  }
}

main()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
