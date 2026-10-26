/**
 * One-off heal (2026-10-26): נספרסו Q3-2026 missed two branches.
 * The parser stopped at a hardcoded Excel row 28; the file runs to row 30, so
 * וילג' / קינג קונג עפולה (row 29) and קינג קונג מוצקין (row 30) were dropped.
 * Parser fixed (727eff2); this re-parses the live file, syncs commissions and
 * flags the Q3 sessions stale.
 *
 * Usage:
 *   npx tsx src/scripts/heal-nespresso-q3-2026-rows-29-30.ts           # dry-run
 *   npx tsx src/scripts/heal-nespresso-q3-2026-rows-29-30.ts --apply   # write
 */

import "dotenv/config";
import { reprocessSupplierFileById } from "@/data-access/supplier-file-reprocess";
import {
  getSupplierFileById,
  syncCommissionsFromUpload,
} from "@/data-access/supplier-file-uploads";
import { markSupplierSessionsStale } from "@/data-access/reconciliation-v2";

const FILE_ID = "f47e13d4-9a6d-469a-8226-91b266f53006";
// 22 branch rows with capsules, minus the blacklisted office line (row 10).
const EXPECTED_MATCHED = 20;

function matchedCount(file: Awaited<ReturnType<typeof getSupplierFileById>>): number {
  return (file?.processingResult?.franchiseeMatches ?? []).filter(
    (m) => m.matchedFranchiseeId && m.matchType !== "blacklisted"
  ).length;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const file = await getSupplierFileById(FILE_ID);
  if (!file) throw new Error(`file ${FILE_ID} not found`);
  const before = matchedCount(file);
  console.log(`${file.originalFileName} [${file.processingStatus}] ${file.periodStartDate}→${file.periodEndDate} matched ${before}`);

  if (before === EXPECTED_MATCHED) {
    console.log("SKIP (done): file already has all branches");
  } else if (apply) {
    const rep = await reprocessSupplierFileById(FILE_ID);
    if (!rep.success) throw new Error(`reprocess failed: ${rep.error}`);
    const after = matchedCount(await getSupplierFileById(FILE_ID));
    console.log(`reprocessed: matched ${before} → ${after}`);
    if (after !== EXPECTED_MATCHED) {
      throw new Error(`unexpected ${after} matched (expected ${EXPECTED_MATCHED}) — stopping before commissions`);
    }
  } else {
    console.log(`WOULD reprocess: matched ${before} → ${EXPECTED_MATCHED}`);
  }

  if (!apply) {
    console.log("(dry run — re-run with --apply)");
    process.exit(0);
  }

  const sync = await syncCommissionsFromUpload(FILE_ID, file.createdBy!);
  console.log(`commissions: ${JSON.stringify(sync)}`);

  const flagged = await markSupplierSessionsStale(file.supplierId, file.periodStartDate!, file.periodEndDate!);
  console.log(`sessions flagged stale: ${flagged}`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
