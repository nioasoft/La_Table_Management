/**
 * Import ימה וקדמה Q2-2026 straight from the supplier's original file.
 *
 * Replays exactly what the admin uploader does — parse, match franchisees,
 * store the file, create the supplier_file_upload row, then
 * syncCommissionsFromUpload — so the result is indistinguishable from a UI
 * upload. Nothing here writes commissions by hand.
 *
 * The source file is the supplier's original export trimmed to 01/04–30/06:
 * the export they sent covered 01/04–01/07 and syncCommissionsFromUpload sums
 * every parsed row regardless of date, so the July tail would have inflated Q2.
 *
 * Run:  npx tsx src/scripts/import-yama-q2-2026.ts <file>          (dry run)
 *       npx tsx src/scripts/import-yama-q2-2026.ts <file> --apply
 */
import "dotenv/config";
import { readFileSync } from "node:fs";
import { basename } from "node:path";
import { database, pool } from "../db";
import { supplier, supplierFileUpload, user as userTable } from "../db/schema";
import { and, eq, gte, lte, ne, desc } from "drizzle-orm";
import { processSupplierFile, getCurrentVatRate } from "../lib/file-processor";
import { matchFranchiseeNamesFromFileWithAnomalies } from "../data-access/franchisees";
import { uploadDocument } from "../lib/storage";
import {
  createSupplierFileUpload,
  syncCommissionsFromUpload,
} from "../data-access/supplier-file-uploads";
import type { SupplierFileProcessingResult } from "../db/schema";

const APPLY = process.argv.includes("--apply");
const filePath = process.argv[2];

const SUPPLIER_CODE = "YAMA_VEKADMA";
const PERIOD_START = "2026-04-01";
const PERIOD_END = "2026-06-30";

async function main() {
  if (!filePath || filePath.startsWith("--")) {
    throw new Error("Usage: import-yama-q2-2026.ts <file> [--apply]");
  }

  const [sup] = await database
    .select()
    .from(supplier)
    .where(eq(supplier.code, SUPPLIER_CODE))
    .limit(1);
  if (!sup) throw new Error(`Supplier ${SUPPLIER_CODE} not found`);

  console.log(
    `Supplier: ${sup.name} | rate=${sup.defaultCommissionRate}% ${sup.commissionType} | frequency=${sup.settlementFrequency} | vatIncluded=${sup.vatIncluded} | vatExempt=${sup.vatExempt}`
  );

  // Refuse to double-import: any live file overlapping the quarter
  const existing = await database
    .select({
      id: supplierFileUpload.id,
      name: supplierFileUpload.originalFileName,
      status: supplierFileUpload.processingStatus,
      start: supplierFileUpload.periodStartDate,
      end: supplierFileUpload.periodEndDate,
      createdAt: supplierFileUpload.createdAt,
    })
    .from(supplierFileUpload)
    .where(
      and(
        eq(supplierFileUpload.supplierId, sup.id),
        ne(supplierFileUpload.processingStatus, "rejected"),
        lte(supplierFileUpload.periodStartDate, PERIOD_END),
        gte(supplierFileUpload.periodEndDate, PERIOD_START)
      )
    )
    .orderBy(desc(supplierFileUpload.createdAt));

  console.log(`\nExisting live files overlapping ${PERIOD_START}..${PERIOD_END}: ${existing.length}`);
  for (const e of existing) {
    console.log(
      `  ${e.createdAt.toISOString().slice(0, 16)} | ${e.name} | ${e.status} | ${e.start}..${e.end}`
    );
  }
  if (existing.length > 0) {
    console.log("\n!! A file already covers this quarter — stopping. Reject it in the UI first.");
    await pool.end();
    return;
  }

  // ── Parse, exactly as the upload endpoint does ────────────────────────────
  const buffer = readFileSync(filePath);
  const fileName = basename(filePath);
  const vatRate = await getCurrentVatRate();

  const result = await processSupplierFile(
    buffer,
    sup.fileMapping,
    sup.vatIncluded ?? false,
    vatRate,
    sup.code ?? undefined,
    sup.vatExempt ?? false,
    undefined,
    fileName
  );

  if (!result.success) {
    console.error("\nParse failed:", JSON.stringify(result.errors, null, 2));
    await pool.end();
    process.exit(1);
  }

  const { rows } = await matchFranchiseeNamesFromFileWithAnomalies(result.data);

  const franchiseeMatches = rows.map((row) => {
    const match = row.matchResult;
    const matchType: "exact" | "fuzzy" | "manual" | "blacklisted" | "none" =
      match?.matchedFranchisee ? (match.confidence === 1 ? "exact" : "fuzzy") : "none";
    return {
      originalName: row.franchisee,
      rowNumber: row.rowNumber,
      grossAmount: row.grossAmount,
      netAmount: row.netAmount,
      matchedFranchiseeId: match?.matchedFranchisee?.id || null,
      matchedFranchiseeName: match?.matchedFranchisee?.name || null,
      confidence: (match?.confidence || 0) * 100,
      matchType,
      requiresReview: match?.requiresReview || !match?.matchedFranchisee,
      preCalculatedCommission: row.preCalculatedCommission,
    };
  });

  console.log("\n=== MATCHES ===");
  for (const m of franchiseeMatches) {
    console.log(
      `  ${m.matchType.padEnd(10)} ${String(Math.round(m.confidence)).padStart(3)}% | ${m.originalName}` +
        `\n      → ${m.matchedFranchiseeName ?? "!! NO MATCH"} | net ${m.netAmount} | gross ${m.grossAmount}`
    );
  }

  const matchStats = {
    total: franchiseeMatches.length,
    exactMatches: franchiseeMatches.filter((m) => m.matchType === "exact").length,
    fuzzyMatches: franchiseeMatches.filter((m) => m.matchType === "fuzzy").length,
    unmatched: franchiseeMatches.filter((m) => m.matchType === "none").length,
    blacklisted: 0,
  };

  const netTotal = franchiseeMatches.reduce((s, m) => s + m.netAmount, 0);
  const rate = Number(sup.defaultCommissionRate ?? 0);
  console.log(
    `\nStats: ${JSON.stringify(matchStats)}\nNet total ${netTotal} → commission @${rate}% ≈ ${(netTotal * rate) / 100}`
  );

  for (const a of result.anomalies ?? []) {
    console.log(`Anomaly [${a.code}/${a.severity}]: ${a.messageHe}`);
  }

  if (matchStats.unmatched > 0) {
    console.log("\n!! Unmatched rows present — fix aliases before importing.");
    await pool.end();
    return;
  }

  if (!APPLY) {
    console.log("\nDry run — pass --apply to write.");
    await pool.end();
    return;
  }

  // ── Write, in the same order the endpoint does ────────────────────────────
  const [admin] = await database
    .select({ id: userTable.id, email: userTable.email })
    .from(userTable)
    .where(eq(userTable.email, "reut32100@gmail.com"))
    .limit(1);
  if (!admin) throw new Error("Admin user not found — cannot attribute the upload");

  const upload = await uploadDocument(
    buffer,
    fileName,
    "application/vnd.ms-excel",
    "supplier",
    sup.id
  );
  console.log(`\nStored at ${upload.url}`);

  const processingResult: SupplierFileProcessingResult = {
    totalRows: result.summary.totalRows,
    processedRows: result.summary.processedRows,
    skippedRows: result.summary.skippedRows,
    totalGrossAmount: result.summary.totalGrossAmount,
    totalNetAmount: result.summary.totalNetAmount,
    vatAdjusted: sup.vatIncluded ?? false,
    matchStats,
    franchiseeMatches,
    processedAt: new Date().toISOString(),
    anomalies: result.anomalies,
  };

  const newFile = await createSupplierFileUpload({
    supplierId: sup.id,
    originalFileName: fileName,
    fileUrl: upload.url,
    fileSize: upload.fileSize,
    processingStatus: matchStats.unmatched === 0 && matchStats.fuzzyMatches === 0
      ? "auto_approved"
      : "needs_review",
    processingResult,
    periodStartDate: PERIOD_START,
    periodEndDate: PERIOD_END,
    createdBy: admin.id,
  });
  console.log(`Created supplier_file_upload ${newFile.id} (${newFile.processingStatus})`);

  const sync = await syncCommissionsFromUpload(newFile.id, admin.id);
  console.log(`Commission sync: ${JSON.stringify(sync)}`);

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
