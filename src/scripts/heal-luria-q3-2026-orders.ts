/**
 * One-off heal (2026-10-19): יקב לוריא Q3-2026 billed double.
 * The export listed every order ("הזמנה") next to its invoice, and the parser
 * summed both: ₪189,330 net instead of ₪94,301. Parser fixed; this re-parses
 * the live file, syncs commissions and flags the Q3 sessions stale (Reut
 * clicks "בנה מחדש").
 *
 * Usage:
 *   npx tsx src/scripts/heal-luria-q3-2026-orders.ts           # dry-run
 *   npx tsx src/scripts/heal-luria-q3-2026-orders.ts --apply   # write
 */

import "dotenv/config";
import { reprocessSupplierFileById } from "@/data-access/supplier-file-reprocess";
import {
  getSupplierFileById,
  syncCommissionsFromUpload,
} from "@/data-access/supplier-file-uploads";
import { markSupplierSessionsStale } from "@/data-access/reconciliation-v2";

const FILE_ID = "c06fc4fc-e022-4d1f-9961-29ca437f891b";
const EXPECTED_NET = 94301;

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const file = await getSupplierFileById(FILE_ID);
  if (!file) throw new Error(`file ${FILE_ID} not found`);
  const net = Number(file.processingResult?.totalNetAmount ?? 0);
  console.log(`${file.originalFileName} [${file.processingStatus}] ${file.periodStartDate}→${file.periodEndDate} net ₪${net}`);

  if (Math.abs(net - EXPECTED_NET) <= 2) {
    console.log("SKIP (done): file already at the invoice-only total");
  } else if (apply) {
    const rep = await reprocessSupplierFileById(FILE_ID);
    if (!rep.success) throw new Error(`reprocess failed: ${rep.error}`);
    console.log(`reprocessed: net ₪${rep.before.net} → ₪${rep.after.net}`);
    if (Math.abs(rep.after.net - EXPECTED_NET) > 2) {
      throw new Error(`unexpected net ₪${rep.after.net} (expected ₪${EXPECTED_NET}) — stopping before commissions`);
    }
  } else {
    console.log(`WOULD reprocess: net ₪${net} → ₪${EXPECTED_NET}`);
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
