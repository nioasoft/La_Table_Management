/**
 * One-off: fix Q2-2026 commission-sync issues found 2026-07-22.
 *
 * 1. שרי שוקו — delete 11 duplicate commissions (Q1 file mistagged as April,
 *    upload 53d3f7a3) + reject that upload so it stops covering the period.
 * 2. פסטה לה קאזה Q2 — 7 per-branch uploads were period-tagged as single days
 *    (the lone invoice date) and never synced. Retag to Q2 and sync each.
 * 3. דגי הקיבוצים Q2 — 20 per-franchisee uploads synced one-by-one; the old
 *    period-wide cleanup left only the last file's row. Re-sync all 20 with
 *    the fixed sibling-sparing cleanup.
 *
 * Usage: dotenv -e .env -- npx tsx fix-q2-sync-issues.ts [--apply]
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { commission, supplierFileUpload, supplier } from "@/db/schema";
import { eq, and, inArray } from "drizzle-orm";
import { syncCommissionsFromUpload } from "@/data-access/supplier-file-uploads";

// Reut — owner of the upload reviews (same convention as fix-mizrach-q1-2026).
const REVIEWER_USER_ID = "YeUolzuyyTtH7d7bXEHeGIR3GewDlSE8";
const SHERI_MISTAGGED_UPLOAD = "53d3f7a3-b6dd-42c8-95cc-e87f80f2a661";

const apply = process.argv.includes("--apply");

async function supplierIdByCode(code: string): Promise<string> {
  const [row] = await database.select({ id: supplier.id }).from(supplier).where(eq(supplier.code, code)).limit(1);
  if (!row) throw new Error(`supplier ${code} not found`);
  return row.id;
}

async function commissionState(supplierId: string, pstart: string, pend: string): Promise<string> {
  const rows = await database
    .select({ net: commission.netAmount, comm: commission.commissionAmount })
    .from(commission)
    .where(and(
      eq(commission.supplierId, supplierId),
      eq(commission.periodStartDate, pstart),
      eq(commission.periodEndDate, pend),
    ));
  const net = rows.reduce((a, r) => a + parseFloat(r.net ?? "0"), 0);
  const comm = rows.reduce((a, r) => a + parseFloat(r.comm), 0);
  return `${rows.length} rows, net=₪${net.toFixed(0)}, commission=₪${comm.toFixed(0)}`;
}

async function main() {
  // ---- 1. שרי שוקו ----
  const sheriId = await supplierIdByCode("SHERI_CHOCO");
  const sheriDupes = await database
    .select({ id: commission.id, status: commission.status })
    .from(commission)
    .where(and(
      eq(commission.supplierId, sheriId),
      eq(commission.periodStartDate, "2026-04-01"),
      eq(commission.periodEndDate, "2026-04-30"),
    ));
  const nonCalculated = sheriDupes.filter((c) => c.status !== "calculated");
  if (nonCalculated.length > 0) throw new Error(`sheri: ${nonCalculated.length} rows not 'calculated' — aborting`);
  console.log(`[sheri] April-duplicate commissions to delete: ${sheriDupes.length}`);

  if (apply) {
    await database.delete(commission).where(inArray(commission.id, sheriDupes.map((c) => c.id)));
    await database.update(supplierFileUpload).set({
      processingStatus: "rejected",
      reviewNotes: "תויג בטעות כאפריל 2026 — הקובץ הוא דוח רבעון 1 שהועלה שוב מתויג נכון (3da2ba49). העמלות הכפולות נמחקו 2026-07-22.",
      reviewedBy: REVIEWER_USER_ID,
      reviewedAt: new Date(),
      updatedAt: new Date(),
    }).where(eq(supplierFileUpload.id, SHERI_MISTAGGED_UPLOAD));
    console.log("[sheri] deleted duplicates + rejected mistagged upload");
  }

  // ---- 2. פסטה לה קאזה Q2 — retag + sync ----
  const pastaId = await supplierIdByCode("PASTA_LA_CASA");
  const pastaFiles = await database
    .select({ id: supplierFileUpload.id, name: supplierFileUpload.originalFileName, ps: supplierFileUpload.periodStartDate })
    .from(supplierFileUpload)
    .where(and(
      eq(supplierFileUpload.supplierId, pastaId),
      inArray(supplierFileUpload.processingStatus, ["approved", "auto_approved"]),
    ));
  const pastaQ2 = pastaFiles.filter((f) => f.ps !== null && f.ps >= "2026-04-01" && f.ps <= "2026-06-30");
  console.log(`[pasta] Q2 files to retag+sync: ${pastaQ2.length}`);
  console.log(`[pasta] BEFORE: ${await commissionState(pastaId, "2026-04-01", "2026-06-30")}`);

  if (apply) {
    for (const f of pastaQ2) {
      await database.update(supplierFileUpload).set({
        periodStartDate: "2026-04-01",
        periodEndDate: "2026-06-30",
        updatedAt: new Date(),
      }).where(eq(supplierFileUpload.id, f.id));
      const r = await syncCommissionsFromUpload(f.id, REVIEWER_USER_ID);
      console.log(`[pasta] ${f.name}: ${JSON.stringify(r)}`);
    }
    console.log(`[pasta] AFTER: ${await commissionState(pastaId, "2026-04-01", "2026-06-30")}`);
  }

  // ---- 3. דגי הקיבוצים Q2 — re-sync all files ----
  const dageiId = await supplierIdByCode("DAGEI_HAKIBBUTZIM");
  const dageiFiles = await database
    .select({ id: supplierFileUpload.id, name: supplierFileUpload.originalFileName })
    .from(supplierFileUpload)
    .where(and(
      eq(supplierFileUpload.supplierId, dageiId),
      eq(supplierFileUpload.periodStartDate, "2026-04-01"),
      eq(supplierFileUpload.periodEndDate, "2026-06-30"),
      inArray(supplierFileUpload.processingStatus, ["approved", "auto_approved"]),
    ));
  console.log(`[dagei] Q2 files to re-sync: ${dageiFiles.length}`);
  console.log(`[dagei] BEFORE: ${await commissionState(dageiId, "2026-04-01", "2026-06-30")}`);

  if (apply) {
    for (const f of dageiFiles) {
      const r = await syncCommissionsFromUpload(f.id, REVIEWER_USER_ID);
      console.log(`[dagei] ${f.name}: ${JSON.stringify(r)}`);
    }
    console.log(`[dagei] AFTER: ${await commissionState(dageiId, "2026-04-01", "2026-06-30")}`);
  }

  if (!apply) console.log("\n(dry run — re-run with --apply to write)");
  process.exit(0);
}

main().catch((e) => { console.error(e); process.exit(1); });
