/**
 * One-off CLI: reprocess the three Q3-2026 supplier files that failed with
 * "Failed to parse the file" after their suppliers changed layouts (2026-10):
 *   - מזרח ומערב — new "שם סוכן" column in A shifted every column right
 *   - פאנדנגו    — itmCode/qty moved in front; purchases F→H, commission G→I
 *   - מעדני הטבע — per-product report became per-month ("סכום בשקלים" in F)
 * Parsers are header-anchored now. The failure path stored no period, so the
 * files were invisible to the חסרים board and reconciliation — set Q3-2026
 * (verified from the files: title "רבעון 3 2026", "7-9.26", dates 7/1–9/28).
 *
 * Status stays needs_review: Reut approves in the review UI, which syncs
 * commissions. Usage:
 *   npx tsx src/scripts/reprocess-q3-2026-layout-wave.ts [--apply]
 */

import "dotenv/config";
import { database } from "@/db";
import { supplier, supplierFileUpload, type SupplierFileProcessingResult } from "@/db/schema";
import { and, eq, gte, lte, ne } from "drizzle-orm";
import { reprocessSupplierFileById } from "@/data-access/supplier-file-reprocess";

const FILE_IDS = [
  "2544a8c1-be7c-43bf-946a-365f671edb84", // מזרח ומערב
  "906ea753-9dd4-4878-8668-5357ea5ab42d", // מעדני הטבע
  "c7ca7707-a136-414d-a141-36e3d145b090", // פאנדנגו
];
const PERIOD_START = "2026-07-01";
const PERIOD_END = "2026-09-30";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  for (const fileId of FILE_IDS) {
    const [file] = await database
      .select({
        supplierId: supplierFileUpload.supplierId,
        name: supplierFileUpload.originalFileName,
        status: supplierFileUpload.processingStatus,
        frequency: supplier.settlementFrequency,
        supplierName: supplier.name,
      })
      .from(supplierFileUpload)
      .innerJoin(supplier, eq(supplier.id, supplierFileUpload.supplierId))
      .where(eq(supplierFileUpload.id, fileId))
      .limit(1);
    if (!file) throw new Error(`file ${fileId} not found`);

    const overlapping = await database
      .select({ id: supplierFileUpload.id, status: supplierFileUpload.processingStatus })
      .from(supplierFileUpload)
      .where(
        and(
          eq(supplierFileUpload.supplierId, file.supplierId),
          ne(supplierFileUpload.id, fileId),
          lte(supplierFileUpload.periodStartDate, PERIOD_END),
          gte(supplierFileUpload.periodEndDate, PERIOD_START)
        )
      );

    console.log(`\n=== ${file.supplierName} — ${file.name} [${file.status}, ${file.frequency}]`);
    if (overlapping.length > 0) {
      console.log(`  ⚠ overlapping Q3 files: ${JSON.stringify(overlapping)} — skipping`);
      continue;
    }
    if (!apply) continue;

    const rep = await reprocessSupplierFileById(fileId);
    if (!rep.success) throw new Error(`reprocess failed for ${file.supplierName}: ${rep.error}`);

    await database
      .update(supplierFileUpload)
      .set({ periodStartDate: PERIOD_START, periodEndDate: PERIOD_END, updatedAt: new Date() })
      .where(eq(supplierFileUpload.id, fileId));

    const [after] = await database
      .select({ pr: supplierFileUpload.processingResult })
      .from(supplierFileUpload)
      .where(eq(supplierFileUpload.id, fileId));
    const pr = after.pr as SupplierFileProcessingResult;
    const commission = pr.franchiseeMatches.reduce((s, m) => s + (m.preCalculatedCommission ?? 0), 0);
    console.log(`  net ₪${rep.after.net}  pre-calc commission ₪${commission}  unmatched=${pr.matchStats.unmatched}`);
    for (const m of pr.franchiseeMatches) {
      console.log(`    ${m.originalName}  =>  ${m.matchedFranchiseeName ?? "UNMATCHED"} [${m.matchType}]  net=${m.netAmount}`);
    }
  }

  if (!apply) console.log("\n(dry run — re-run with --apply)");
  process.exit(0);
}

main();
