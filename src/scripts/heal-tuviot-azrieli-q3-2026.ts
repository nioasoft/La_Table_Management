/**
 * One-off heal (2026-10-18): תויות הצפון Q3-2026 dropped "ויני עזריאלי / נתנזון".
 * Blank "0.00" spacer rows in that block closed it before its total row, so
 * the ₪8,875 net never reached the file, commissions or reconciliation.
 * Parser fixed; this re-parses the live file, syncs commissions and flags the
 * Q3 sessions stale (Reut clicks "בנה מחדש").
 *
 * Usage:
 *   npx tsx src/scripts/heal-tuviot-azrieli-q3-2026.ts           # dry-run
 *   npx tsx src/scripts/heal-tuviot-azrieli-q3-2026.ts --apply   # write
 */

import "dotenv/config";
import { reprocessSupplierFileById } from "@/data-access/supplier-file-reprocess";
import {
  getSupplierFileById,
  syncCommissionsFromUpload,
} from "@/data-access/supplier-file-uploads";
import { markSupplierSessionsStale } from "@/data-access/reconciliation-v2";

const FILE_ID = "f91713b1-6fd5-45ae-af25-f154a0feb5a0";
const AZRIELI = "ויני עזריאלי / נתנזון";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const file = await getSupplierFileById(FILE_ID);
  if (!file) throw new Error(`file ${FILE_ID} not found`);
  console.log(`${file.originalFileName} [${file.processingStatus}] ${file.periodStartDate}→${file.periodEndDate}`);

  const before = file.processingResult?.franchiseeMatches.find((m) => m.originalName === AZRIELI);
  if (before) {
    console.log(`SKIP (done): ${AZRIELI} already on the file → ${before.matchedFranchiseeName}`);
  } else if (apply) {
    const rep = await reprocessSupplierFileById(FILE_ID);
    if (!rep.success) throw new Error(`reprocess failed: ${rep.error}`);
    console.log(`reprocessed: net ₪${rep.before.net} → ₪${rep.after.net}`);
  } else {
    console.log(`WOULD reprocess to add ${AZRIELI}`);
  }

  if (!apply) {
    console.log("(dry run — re-run with --apply)");
    process.exit(0);
  }

  const after = await getSupplierFileById(FILE_ID);
  const row = after!.processingResult!.franchiseeMatches.find((m) => m.originalName === AZRIELI);
  if (!row?.matchedFranchiseeId) throw new Error(`${AZRIELI} still missing or unmatched after reprocess`);
  console.log(`${AZRIELI} → ${row.matchedFranchiseeName} [${row.matchType}] net=${row.netAmount} gross=${row.grossAmount}`);

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
