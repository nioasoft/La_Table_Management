/**
 * One-off: recover Q1-2026 commissions for the multi-file suppliers hit by
 * the last-file-wins sync bug (see fix-q2-sync-issues.ts / commit 529ed42).
 * Re-syncs every approved Q1 upload for דגי הקיבוצים + פסטה לה קאזה.
 *
 * Note: dagei's `documents (18).xlsx` is an unmatched duplicate of
 * `קינג רעננה.xlsx` (same ₪245,645) — sync skips it (no eligible matches).
 *
 * Usage: dotenv -e .env -- npx tsx src/scripts/fix-q1-resync.ts [--apply]
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { commission, supplierFileUpload, supplier } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { syncCommissionsFromUpload } from "@/data-access/supplier-file-uploads";

const REVIEWER_USER_ID = "YeUolzuyyTtH7d7bXEHeGIR3GewDlSE8"; // Reut
const PERIOD_START = "2026-01-01";
const PERIOD_END = "2026-03-31";
const SUPPLIER_CODES = ["DAGEI_HAKIBBUTZIM", "PASTA_LA_CASA"];

const apply = process.argv.includes("--apply");

async function commissionState(supplierId: string): Promise<string> {
  const rows = await database
    .select({ net: commission.netAmount, comm: commission.commissionAmount })
    .from(commission)
    .where(and(
      eq(commission.supplierId, supplierId),
      eq(commission.periodStartDate, PERIOD_START),
      eq(commission.periodEndDate, PERIOD_END),
    ));
  const net = rows.reduce((a, r) => a + parseFloat(r.net ?? "0"), 0);
  const comm = rows.reduce((a, r) => a + parseFloat(r.comm), 0);
  return `${rows.length} rows, net=₪${net.toFixed(0)}, commission=₪${comm.toFixed(0)}`;
}

async function main() {
  for (const code of SUPPLIER_CODES) {
    const [sup] = await database.select({ id: supplier.id }).from(supplier).where(eq(supplier.code, code)).limit(1);
    if (!sup) throw new Error(`supplier ${code} not found`);

    const files = await database
      .select({ id: supplierFileUpload.id, name: supplierFileUpload.originalFileName })
      .from(supplierFileUpload)
      .where(and(
        eq(supplierFileUpload.supplierId, sup.id),
        eq(supplierFileUpload.periodStartDate, PERIOD_START),
        eq(supplierFileUpload.periodEndDate, PERIOD_END),
        inArray(supplierFileUpload.processingStatus, ["approved", "auto_approved"]),
      ));

    console.log(`\n[${code}] Q1 files: ${files.length}`);
    console.log(`[${code}] BEFORE: ${await commissionState(sup.id)}`);

    if (apply) {
      for (const f of files) {
        const r = await syncCommissionsFromUpload(f.id, REVIEWER_USER_ID);
        console.log(`[${code}] ${f.name}: ${JSON.stringify(r)}`);
      }
      console.log(`[${code}] AFTER: ${await commissionState(sup.id)}`);
    }
  }
  if (!apply) console.log("\n(dry run — re-run with --apply to write)");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
