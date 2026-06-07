/**
 * One-off: backfill the missing supplier_file_upload record for לאומי קארד so
 * its 13 (correct) commissions appear in "דוח קבצי ספקים".
 *
 * Background: Reut uploaded the Leumi Card annual file 2026-06-07. The
 * process-file PREVIEW created 13 commissions (source_file_id NULL) but the SAVE
 * step that creates the supplier_file_upload never completed, so the data is
 * present in commission totals but invisible in the supplier-files report.
 * (The preview-orphan bug is fixed going forward — see B2.)
 *
 * This reconstructs the upload record from the existing commissions and links
 * them via source_file_id. It does NOT re-sync/recompute, so the correct amounts
 * are untouched. fileUrl is null (the original file isn't stored); if Reut later
 * re-uploads the real file, the save flow replaces these cleanly.
 *
 *   dotenv -e .env -- npx tsx src/scripts/backfill-leumi-card-upload.ts [--dry-run]
 */
import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { commission, franchisee, supplier } from "@/db/schema";
import type { SupplierFileProcessingResult } from "@/db/schema";
import { eq, and, isNull, inArray } from "drizzle-orm";
import { createSupplierFileUpload } from "@/data-access/supplier-file-uploads";

const SUPPLIER_CODE = "LEUMI_CARD";
const REUT_USER_ID = "YeUolzuyyTtH7d7bXEHeGIR3GewDlSE8";
const DRY_RUN = process.argv.includes("--dry-run");

async function main() {
  const [sup] = await database
    .select({ id: supplier.id, name: supplier.name })
    .from(supplier)
    .where(eq(supplier.code, SUPPLIER_CODE))
    .limit(1);
  if (!sup) throw new Error("Leumi Card supplier not found");

  // The orphaned commissions: this supplier, no source file yet.
  const rows = await database
    .select({
      id: commission.id,
      franchiseeId: commission.franchiseeId,
      franchiseeName: franchisee.name,
      grossAmount: commission.grossAmount,
      netAmount: commission.netAmount,
      commissionAmount: commission.commissionAmount,
      periodStartDate: commission.periodStartDate,
      periodEndDate: commission.periodEndDate,
    })
    .from(commission)
    .innerJoin(franchisee, eq(franchisee.id, commission.franchiseeId))
    .where(
      and(eq(commission.supplierId, sup.id), isNull(commission.sourceFileId))
    );

  if (rows.length === 0) {
    console.log("No orphaned Leumi Card commissions found — nothing to backfill.");
    process.exit(0);
  }

  const periodStartDate = rows[0].periodStartDate;
  const periodEndDate = rows[0].periodEndDate;

  // Reconstruct franchiseeMatches from the commissions (all matched exactly by
  // ח.פ.). For Leumi, preCalculatedCommission = the recorded commission amount.
  let totalGross = 0;
  let totalNet = 0;
  const franchiseeMatches = rows.map((r, i) => {
    const gross = Number(r.grossAmount);
    const net = Number(r.netAmount);
    totalGross += gross;
    totalNet += net;
    return {
      originalName: r.franchiseeName,
      rowNumber: i + 1,
      grossAmount: gross,
      netAmount: net,
      matchedFranchiseeId: r.franchiseeId,
      matchedFranchiseeName: r.franchiseeName,
      confidence: 100,
      matchType: "exact" as const,
      requiresReview: false,
      preCalculatedCommission: Number(r.commissionAmount),
    };
  });

  const processingResult: SupplierFileProcessingResult = {
    totalRows: rows.length,
    processedRows: rows.length,
    skippedRows: 0,
    totalGrossAmount: totalGross,
    totalNetAmount: totalNet,
    vatAdjusted: false,
    matchStats: {
      total: rows.length,
      exactMatches: rows.length,
      fuzzyMatches: 0,
      unmatched: 0,
    },
    franchiseeMatches,
    processedAt: new Date().toISOString(),
  };

  console.log(
    `Leumi Card: ${rows.length} orphaned commissions, period ${periodStartDate}..${periodEndDate}, ` +
      `gross=${totalGross}, commissions=${franchiseeMatches.reduce((s, m) => s + (m.preCalculatedCommission || 0), 0)}`
  );

  if (DRY_RUN) {
    console.log("[dry-run] would create supplier_file_upload + link", rows.length, "commissions");
    process.exit(0);
  }

  const newFile = await createSupplierFileUpload({
    supplierId: sup.id,
    originalFileName: "לאומי קארד – שנתי (שחזור רשומה).xlsx",
    fileUrl: null,
    fileSize: 0,
    processingStatus: "auto_approved",
    processingResult,
    periodStartDate,
    periodEndDate,
    createdBy: REUT_USER_ID,
  });
  console.log("Created supplier_file_upload:", newFile.id);

  const ids = rows.map((r) => r.id);
  const linked = await database
    .update(commission)
    .set({ sourceFileId: newFile.id })
    .where(inArray(commission.id, ids))
    .returning({ id: commission.id });
  console.log(`Linked ${linked.length} commissions to source_file_id=${newFile.id}`);

  process.exit(0);
}

main().catch((err) => {
  console.error("Backfill failed:", err);
  process.exit(1);
});
