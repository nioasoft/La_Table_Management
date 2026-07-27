/**
 * One-off: clear the stale flags that the 2026-07-27 opening-balance heal set
 * on sessions whose data never actually changed.
 *
 * The heal replayed 5-6 overlapping BKMV files per franchisee. Each replay was
 * diffed against the state the previous one left, so months flipped back and
 * forth and every flip flagged sessions — even though only January's amounts
 * moved. (The cause is fixed in cd15bb4 via skipStaleMarking.)
 *
 * Scope is deliberately narrow and each condition matters:
 *   - flagged inside the heal's own window, so later flags from real work in
 *     the app are left alone;
 *   - period does not cover January, the only month whose data changed;
 *   - the franchisee-side amount stored on every row still matches the current
 *     BKMV data, re-checked here rather than trusted from the earlier analysis.
 *
 * A session that fails the amount check keeps its flag.
 *
 *   npx tsx src/scripts/clear-spurious-stale-flags.ts          # dry run
 *   npx tsx src/scripts/clear-spurious-stale-flags.ts --apply
 */
import { database } from "@/db";
import { reconciliationSession } from "@/db/schema";
import { sql, inArray } from "drizzle-orm";

const APPLY = process.argv.includes("--apply");

const HEAL_WINDOW_START = "2026-07-27 09:09:00+00";
const HEAL_WINDOW_END = "2026-07-27 09:11:00+00";

/** Franchisee-side amount a row would get if the session were rebuilt now. */
const CURRENT_NET = sql`
  round(COALESCE((
    SELECT sum((e->>'amount')::numeric)
    FROM franchisee_bkmv_year y
    CROSS JOIN LATERAL jsonb_each(y.monthly_breakdown) AS m(month, entries)
    CROSS JOIN LATERAL jsonb_array_elements(m.entries) AS e
    WHERE y.franchisee_id = rc.franchisee_id
      AND m.month >= to_char(rs.period_start_date::date, 'YYYY-MM')
      AND m.month <= to_char(rs.period_end_date::date, 'YYYY-MM')
      AND e->>'supplierId' = rs.supplier_id
  ), 0) / 1.18)`;

async function main() {
  const candidates = await database.execute<{
    id: string;
    supplier: string;
    period_start_date: string;
    period_end_date: string;
    drifted_rows: number;
  }>(sql`
    SELECT rs.id, s.name AS supplier, rs.period_start_date, rs.period_end_date,
           count(*) FILTER (WHERE abs(rc.franchisee_amount - ${CURRENT_NET}) > 2) AS drifted_rows
    FROM ${reconciliationSession} rs
    JOIN supplier s ON s.id = rs.supplier_id
    JOIN reconciliation_comparison rc ON rc.session_id = rs.id
    WHERE rs.archived_at IS NULL
      AND rs.stale_at >= ${HEAL_WINDOW_START}::timestamptz
      AND rs.stale_at <  ${HEAL_WINDOW_END}::timestamptz
      AND NOT EXISTS (
        SELECT 1 FROM generate_series(
          date_trunc('month', rs.period_start_date::date),
          date_trunc('month', rs.period_end_date::date),
          interval '1 month') g
        WHERE extract(month FROM g) = 1
      )
    GROUP BY rs.id, s.name, rs.period_start_date, rs.period_end_date
    ORDER BY s.name
  `);

  const clean = candidates.rows.filter((r) => Number(r.drifted_rows) === 0);
  const dirty = candidates.rows.filter((r) => Number(r.drifted_rows) > 0);

  for (const r of clean) {
    console.log(`clear  ${r.supplier} ${r.period_start_date}→${r.period_end_date}`);
  }
  for (const r of dirty) {
    console.log(
      `KEEP   ${r.supplier} ${r.period_start_date}→${r.period_end_date} — ${r.drifted_rows} rows differ from current BKMV`
    );
  }

  console.log(
    `\n${candidates.rows.length} sessions in the heal window without January; ${clean.length} clean, ${dirty.length} keep their flag`
  );

  if (!APPLY) {
    console.log("dry run — run again with --apply to clear");
    process.exit(0);
  }

  if (clean.length > 0) {
    await database
      .update(reconciliationSession)
      .set({ staleAt: null })
      .where(inArray(reconciliationSession.id, clean.map((r) => r.id)));
  }
  console.log(`${clean.length} flags cleared`);
  process.exit(0);
}

main();
