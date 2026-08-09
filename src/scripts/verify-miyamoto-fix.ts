/**
 * Read-only: confirm the חסרים board now sees the backfilled link uploads.
 * Runs the dashboard's own query for Q2-2026.
 *
 * Run: npx tsx src/scripts/verify-miyamoto-fix.ts
 */
import "dotenv/config";
import { pool } from "../db";
import { getFranchiseeBkmvStatusForPeriod } from "../data-access/uploadLinks";

const NAMES_OF_INTEREST = ["מיאמוטו", "סידיוס", "כרמיאל", "שרונה"];

async function main() {
  for (const [label, start, end] of [
    ["Q2-2026", "2026-04-01", "2026-06-30"],
    ["Q1-2026", "2026-01-01", "2026-03-31"],
  ] as const) {
    const { franchisees } = await getFranchiseeBkmvStatusForPeriod(start, end);
    const missing = franchisees.filter((f) => !f.hasFile);
    console.log(
      `\n=== ${label} — ${missing.length}/${franchisees.length} missing ===`
    );
    for (const f of franchisees.filter((x) =>
      NAMES_OF_INTEREST.some((n) => x.name.includes(n))
    )) {
      console.log(`  ${f.hasFile ? "✓ has file" : "✗ MISSING  "} | ${f.name}`);
    }
    console.log(`  --- all still missing: ${missing.map((f) => f.name).join(", ") || "(none)"}`);
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
