/**
 * One-off CLI: re-route קינג קונג מוצקין rows that were frozen onto כרמיאל.
 *
 * Background (Reut, 2026-07-27):
 * קינג קונג מוצקין is a new branch. Until the alias cleanup of 2026-07-23
 * (fix-mizrach-sober-q2-2026.ts), קינג קונג כרמיאל carried מוצקין's aliases,
 * so every file processed before that date fuzzy-matched "קינג קונג מוצקין"
 * onto כרמיאל. That cleanup only reprocessed the mizrach + sober files — five
 * other approved Q2-2026 files kept the wrong match frozen in their stored
 * processing result (matches are never re-run on their own).
 *
 * Found by re-running the matcher against today's aliases over every 2026 file
 * and diffing against the stored match. These five are the complete set.
 *
 * Steps per file: reprocessSupplierFileById (re-parse + rematch) then
 * syncCommissionsFromUpload, then flag the affected sessions stale.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/fix-motzkin-misroute-q2-2026.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import {
  commission,
  franchisee,
  supplierFileUpload,
  type SupplierFileProcessingResult,
} from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { reprocessSupplierFileById } from "@/data-access/supplier-file-reprocess";
import { syncCommissionsFromUpload } from "@/data-access/supplier-file-uploads";
import { markSupplierSessionsStale } from "@/data-access/reconciliation-v2";

const PERIOD_START = "2026-04-01";
const PERIOD_END = "2026-06-30";
// Reut — owner of the original upload reviews (same as fix-dagei-q2-2026.ts)
const REVIEWER_USER_ID = "YeUolzuyyTtH7d7bXEHeGIR3GewDlSE8";

const MOTZKIN_ID = "4b491588-72aa-43ea-8f55-9cd814e6d503";
const KARMIEL_ID = "f197a539-257a-44b7-9eb4-25e919515217";

// Five files carried the misroute. Reut re-uploaded three of them by hand on
// 2026-07-27 (פאנדנגו ₪5,110, מור בריאות ₪1,930, מעדני הטבע ₪1,116 — the old
// rows are now rejected and the replacements match מוצקין correctly), so only
// these two are still live with the wrong match.
const FILE_IDS = [
  "51666332-47d8-4566-a7a1-7917d3b7ef1c", // תויות הצפון — ₪3,548
  "7a9a92c7-1ef2-430a-876a-3b7417d212bf", // טרז פזוס — ₪914
];

async function printBranch(franchiseeId: string, label: string): Promise<void> {
  const rows = await database
    .select({
      supplierId: commission.supplierId,
      netAmount: commission.netAmount,
      commissionAmount: commission.commissionAmount,
      status: commission.status,
    })
    .from(commission)
    .where(
      and(
        eq(commission.franchiseeId, franchiseeId),
        eq(commission.periodStartDate, PERIOD_START),
        eq(commission.periodEndDate, PERIOD_END)
      )
    );
  const net = rows.reduce((acc, r) => acc + parseFloat(r.netAmount ?? "0"), 0);
  const comm = rows.reduce((acc, r) => acc + parseFloat(r.commissionAmount), 0);
  console.log(
    `  ${label}: ${rows.length} commission rows, net=₪${net.toFixed(0)}, commission=₪${comm.toFixed(2)}`
  );
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const files = await database
    .select({
      id: supplierFileUpload.id,
      supplierId: supplierFileUpload.supplierId,
      fileName: supplierFileUpload.originalFileName,
      status: supplierFileUpload.processingStatus,
      pr: supplierFileUpload.processingResult,
    })
    .from(supplierFileUpload)
    .where(inArray(supplierFileUpload.id, FILE_IDS));

  if (files.length !== FILE_IDS.length) {
    throw new Error(`expected ${FILE_IDS.length} files, found ${files.length}`);
  }

  const names = await database
    .select({ id: franchisee.id, name: franchisee.name })
    .from(franchisee);
  const nameById = new Map(names.map((f) => [f.id, f.name]));

  console.log("BEFORE:");
  await printBranch(MOTZKIN_ID, "קינג קונג מוצקין");
  await printBranch(KARMIEL_ID, "קינג קונג כרמיאל ");
  for (const f of files) {
    const pr = f.pr as SupplierFileProcessingResult | null;
    const rows = (pr?.franchiseeMatches ?? []).filter((m) =>
      m.originalName.includes("מוצקין")
    );
    for (const m of rows) {
      console.log(
        `  ${f.fileName} [${f.status}]: "${m.originalName}" net=${m.netAmount} => ${
          m.matchedFranchiseeId ? nameById.get(m.matchedFranchiseeId) : "UNMATCHED"
        } [${m.matchType}]`
      );
    }
  }

  if (!apply) {
    console.log("\n(dry run — re-run with --apply to reprocess and sync)");
    process.exit(0);
  }

  const touchedSuppliers = new Set<string>();
  for (const f of files) {
    console.log(`\nReprocessing ${f.fileName} (${f.id})...`);
    const rep = await reprocessSupplierFileById(f.id);
    if (!rep.success) {
      console.error(`  FAILED: ${rep.error}`);
      continue;
    }
    console.log(`  net ${rep.before.net} -> ${rep.after.net}`);
    const sync = await syncCommissionsFromUpload(f.id, REVIEWER_USER_ID);
    console.log(`  sync:`, sync);
    touchedSuppliers.add(f.supplierId);
  }

  for (const supplierId of touchedSuppliers) {
    const stale = await markSupplierSessionsStale(supplierId, PERIOD_START, PERIOD_END);
    if (stale > 0) console.log(`  flagged ${stale} session(s) stale for supplier ${supplierId}`);
  }

  console.log("\nAFTER:");
  await printBranch(MOTZKIN_ID, "קינג קונג מוצקין");
  await printBranch(KARMIEL_ID, "קינג קונג כרמיאל ");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
