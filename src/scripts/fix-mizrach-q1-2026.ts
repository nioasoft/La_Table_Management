/**
 * One-off CLI: re-sync Mizrach U'Maarav Q1 2026 commissions.
 *
 * Background — the supplier file `קאסטרה רבעון 1 2026 משרד.xlsx`
 * (file id 406590d4-7323-4c6f-b05a-56bf48334be7) produced 10 commission rows
 * in production, all at flat 17%, none linked to the source file, with two
 * franchisees (קינג קונג רעננה, קינג קונג עפולה) missing entirely. The
 * parser had returned a mixed 17%/10% preCalculatedCommission per row, but
 * calculateAndCreateCommission ignored that field and the auto-create path
 * filtered out fuzzy/manual matches.
 *
 * After the code fixes (Bug A/B/C), this script invokes the new
 * syncCommissionsFromUpload helper to replace the stale 10 rows with
 * 11 correct ones. calculateBatchCommissions deletes the existing
 * calculated/pending rows for the period and inserts fresh ones.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/fix-mizrach-q1-2026.ts [--apply]
 *
 * Without --apply: prints the pre-state, predicted post-state, no writes.
 * With    --apply: actually runs the sync.
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { commission, supplierFileUpload } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { syncCommissionsFromUpload } from "@/data-access/supplier-file-uploads";

const FILE_ID = "406590d4-7323-4c6f-b05a-56bf48334be7";
const SUPPLIER_ID = "fef9fe2d-fd35-4c66-a772-d01b36551647";
const PERIOD_START = "2026-01-01";
const PERIOD_END = "2026-03-31";
// Reut — owner of the original upload review.
const REVIEWER_USER_ID = "YeUolzuyyTtH7d7bXEHeGIR3GewDlSE8";

async function printState(label: string): Promise<void> {
  const rows = await database
    .select({
      id: commission.id,
      franchiseeId: commission.franchiseeId,
      netAmount: commission.netAmount,
      commissionRate: commission.commissionRate,
      commissionAmount: commission.commissionAmount,
      sourceFileId: commission.sourceFileId,
    })
    .from(commission)
    .where(
      and(
        eq(commission.supplierId, SUPPLIER_ID),
        eq(commission.periodStartDate, PERIOD_START),
        eq(commission.periodEndDate, PERIOD_END)
      )
    );

  const sum = rows.reduce((acc, r) => acc + parseFloat(r.commissionAmount), 0);
  console.log(`\n=== ${label} ===`);
  console.log(`rows: ${rows.length}, sum(commissionAmount) = ₪${sum.toFixed(2)}`);
  for (const r of rows) {
    console.log(
      `  ${r.id.slice(0, 8)}  net=${r.netAmount}  rate=${r.commissionRate}%  amt=${r.commissionAmount}  src=${r.sourceFileId ?? "NULL"}`
    );
  }
}

async function previewExpected(): Promise<void> {
  const [file] = await database
    .select({
      processingResult: supplierFileUpload.processingResult,
    })
    .from(supplierFileUpload)
    .where(eq(supplierFileUpload.id, FILE_ID))
    .limit(1);

  if (!file?.processingResult?.franchiseeMatches) {
    console.error("processing_result.franchiseeMatches not found for file");
    return;
  }

  const matches = file.processingResult.franchiseeMatches.filter(
    (m) =>
      m.matchedFranchiseeId !== null &&
      m.matchType !== "blacklisted" &&
      m.matchType !== "none"
  );

  // Aggregate by franchiseeId — mirrors syncCommissionsFromUpload
  const byFranchisee = new Map<
    string,
    { netAmount: number; preCalc: number | undefined; names: string[] }
  >();
  for (const m of matches) {
    const id = m.matchedFranchiseeId!;
    const existing = byFranchisee.get(id);
    if (existing) {
      existing.netAmount += m.netAmount;
      if (m.preCalculatedCommission !== undefined) {
        existing.preCalc = (existing.preCalc ?? 0) + m.preCalculatedCommission;
      }
      existing.names.push(m.matchedFranchiseeName ?? "?");
    } else {
      byFranchisee.set(id, {
        netAmount: m.netAmount,
        preCalc: m.preCalculatedCommission,
        names: [m.matchedFranchiseeName ?? "?"],
      });
    }
  }

  console.log(`\n=== EXPECTED AFTER SYNC ===`);
  let total = 0;
  for (const [id, agg] of byFranchisee) {
    total += agg.preCalc ?? 0;
    console.log(
      `  ${agg.names[0].padEnd(30)} net=${agg.netAmount.toFixed(0).padStart(7)}  preCalc=${(agg.preCalc ?? 0).toFixed(0).padStart(6)}  fr=${id.slice(0, 8)}`
    );
  }
  console.log(`expected rows: ${byFranchisee.size}, sum(commissionAmount) = ₪${total.toFixed(2)}`);
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  await printState("BEFORE");
  await previewExpected();

  if (!apply) {
    console.log("\n(dry run — re-run with --apply to write changes)");
    process.exit(0);
  }

  console.log("\nApplying syncCommissionsFromUpload...");
  const result = await syncCommissionsFromUpload(FILE_ID, REVIEWER_USER_ID);
  console.log("syncCommissionsFromUpload result:", result);

  await printState("AFTER");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
