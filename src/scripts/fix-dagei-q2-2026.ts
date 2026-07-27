/**
 * One-off CLI: fix Q2-2026 דגי הקיבוצים after the column-layout parser fix.
 *
 * Background (Reut, 2026-07-27):
 * The דגי הקיבוצים export gained a "מפתח לקוח" column, shifting every later
 * column right by one. The parser read fixed indices, so it summed the מע"מ
 * column (14) instead of "סכום לפני מע"מ" (15) — every Q2 branch landed at
 * ~18% of its real turnover — and read "מפתח לקוח" instead of the ח.פ.
 * The parser is now header-anchored; this script re-parses the stored files.
 *
 * Steps per file (all 20 Q2 files, one per branch):
 *   a. reprocessSupplierFileById — re-parse with the fixed parser + rematch
 *   b. syncCommissionsFromUpload — rewrite the commission rows for that file
 * Then flags the Q2 reconciliation session stale so Reut rebuilds it (session
 * amounts are frozen at build time).
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/fix-dagei-q2-2026.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import {
  commission,
  franchisee,
  supplier,
  supplierFileUpload,
  type SupplierFileProcessingResult,
} from "@/db/schema";
import { eq, and, ne } from "drizzle-orm";
import { reprocessSupplierFileById } from "@/data-access/supplier-file-reprocess";
import { syncCommissionsFromUpload } from "@/data-access/supplier-file-uploads";
import { markSupplierSessionsStale } from "@/data-access/reconciliation-v2";

const SUPPLIER_CODE = "DAGEI_HAKIBBUTZIM";
const PERIOD_START = "2026-04-01";
const PERIOD_END = "2026-06-30";
// Reut — owner of the original upload reviews (same as fix-mizrach-sober-q2-2026.ts)
const REVIEWER_USER_ID = "YeUolzuyyTtH7d7bXEHeGIR3GewDlSE8";

async function printCommissions(supplierId: string, label: string): Promise<void> {
  const rows = await database
    .select({
      franchiseeId: commission.franchiseeId,
      netAmount: commission.netAmount,
      commissionAmount: commission.commissionAmount,
      status: commission.status,
    })
    .from(commission)
    .where(
      and(
        eq(commission.supplierId, supplierId),
        eq(commission.periodStartDate, PERIOD_START),
        eq(commission.periodEndDate, PERIOD_END)
      )
    );

  const franchisees = await database
    .select({ id: franchisee.id, name: franchisee.name })
    .from(franchisee);
  const nameById = new Map(franchisees.map((f) => [f.id, f.name]));

  const net = rows.reduce((acc, r) => acc + parseFloat(r.netAmount), 0);
  const comm = rows.reduce((acc, r) => acc + parseFloat(r.commissionAmount), 0);
  console.log(
    `\n--- commissions ${label}: ${rows.length} rows, net=₪${net.toFixed(0)}, commission=₪${comm.toFixed(2)} ---`
  );
  for (const r of rows) {
    console.log(
      `  ${(nameById.get(r.franchiseeId) ?? r.franchiseeId).padEnd(28)} net=${r.netAmount}  amt=${r.commissionAmount}  [${r.status}]`
    );
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const [dagei] = await database
    .select({ id: supplier.id, name: supplier.name })
    .from(supplier)
    .where(eq(supplier.code, SUPPLIER_CODE))
    .limit(1);
  if (!dagei) throw new Error(`supplier ${SUPPLIER_CODE} not found`);

  const files = await database
    .select({
      id: supplierFileUpload.id,
      fileName: supplierFileUpload.originalFileName,
      status: supplierFileUpload.processingStatus,
      pr: supplierFileUpload.processingResult,
    })
    .from(supplierFileUpload)
    .where(
      and(
        eq(supplierFileUpload.supplierId, dagei.id),
        eq(supplierFileUpload.periodStartDate, PERIOD_START),
        eq(supplierFileUpload.periodEndDate, PERIOD_END),
        ne(supplierFileUpload.processingStatus, "rejected")
      )
    );

  console.log(`${dagei.name}: ${files.length} files for ${PERIOD_START}..${PERIOD_END}`);
  let beforeNet = 0;
  for (const f of files) {
    const pr = f.pr as SupplierFileProcessingResult | null;
    beforeNet += pr?.totalNetAmount ?? 0;
    console.log(`  ${f.fileName.padEnd(24)} [${f.status}] net=${pr?.totalNetAmount ?? 0}`);
  }
  console.log(`  TOTAL net (before) = ₪${beforeNet.toFixed(0)}`);

  await printCommissions(dagei.id, "BEFORE");

  if (!apply) {
    console.log("\n(dry run — re-run with --apply to reprocess and sync)");
    process.exit(0);
  }

  let afterNet = 0;
  const failures: string[] = [];
  for (const f of files) {
    console.log(`\nReprocessing ${f.fileName} (${f.id})...`);
    const rep = await reprocessSupplierFileById(f.id);
    if (!rep.success) {
      console.error(`  FAILED: ${rep.error}`);
      failures.push(`${f.fileName}: ${rep.error}`);
      continue;
    }
    afterNet += rep.after.net;
    console.log(`  net ${rep.before.net} -> ${rep.after.net}`);

    const sync = await syncCommissionsFromUpload(f.id, REVIEWER_USER_ID);
    console.log(`  sync:`, sync);
  }

  console.log(`\nTOTAL net (after) = ₪${afterNet.toFixed(0)}`);
  if (failures.length > 0) {
    console.log(`\n${failures.length} FAILURES:\n  ${failures.join("\n  ")}`);
  }

  const staleCount = await markSupplierSessionsStale(dagei.id, PERIOD_START, PERIOD_END);
  console.log(`\nFlagged ${staleCount} reconciliation session(s) stale — rebuild in the UI.`);

  await printCommissions(dagei.id, "AFTER");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
