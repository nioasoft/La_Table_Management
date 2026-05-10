/**
 * One-off CLI: re-process all BKMV files to rebuild supplierMatches and
 * monthlyBreakdown using current bkmv_aliases. Mirrors the logic of
 * POST /api/bkmvdata/reprocess?force=true.
 *
 * Triggered after Yekev Luria's bkmv_alias "חדד את סיידא" was added but
 * other franchisees' BKMV files were never re-matched.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/reprocess-bkmv-rematch.ts [--dry-run]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { uploadedFile } from "@/db/schema";
import type { BkmvProcessingResult } from "@/db/schema";
import { isNotNull, sql, eq } from "drizzle-orm";
import {
  parseBkmvData,
  buildMonthlyBreakdown,
  convertRevenueSummaryToArray,
  convertAllAccountsSummaryToArray,
  buildAllAccountsSummary,
  buildRevenueMonthlyBreakdown,
  mergeRevenueSummaryIntoAllAccounts,
} from "@/lib/bkmvdata-parser";
import { matchBkmvSuppliers } from "@/lib/supplier-matcher";
import { getSuppliers } from "@/data-access/suppliers";
import { getBlacklistedNamesSet } from "@/data-access/bkmvBlacklist";
import { getSmallSupplierNamesSet } from "@/data-access/bkmvSmallSuppliers";
import { getDocument } from "@/lib/storage";
import { upsertFromFullBreakdown } from "@/data-access/franchisee-bkmv-year";

async function main() {
  const dryRun = process.argv.includes("--dry-run");

  const allBkmvFiles = await database
    .select({
      id: uploadedFile.id,
      fileUrl: uploadedFile.fileUrl,
      franchiseeId: uploadedFile.franchiseeId,
      bkmvProcessingResult: uploadedFile.bkmvProcessingResult,
      processingStatus: uploadedFile.processingStatus,
      periodStartDate: uploadedFile.periodStartDate,
      periodEndDate: uploadedFile.periodEndDate,
      originalFileName: uploadedFile.originalFileName,
    })
    .from(uploadedFile)
    .where(isNotNull(uploadedFile.bkmvProcessingResult));

  console.log(`Found ${allBkmvFiles.length} BKMV files with processing results.`);

  if (dryRun) {
    console.log(`DRY RUN: would reprocess ${allBkmvFiles.length} files.`);
    for (const f of allBkmvFiles) {
      console.log(`  - ${f.id} | ${f.originalFileName} | ${f.periodStartDate}..${f.periodEndDate} | franchisee=${f.franchiseeId}`);
    }
    process.exit(0);
  }

  const allSuppliers = await getSuppliers();
  const blacklistedNames = await getBlacklistedNamesSet();
  const smallSupplierNames = await getSmallSupplierNamesSet();

  let processed = 0;
  let failed = 0;
  let manualMatchesPreserved = 0;
  const errors: Array<{ fileId: string; fileName: string; error: string }> = [];

  for (const [i, file] of allBkmvFiles.entries()) {
    const prefix = `[${i + 1}/${allBkmvFiles.length}] ${file.originalFileName}`;
    try {
      let buffer: Buffer | null = null;
      for (let attempt = 1; attempt <= 4; attempt++) {
        buffer = await getDocument(file.fileUrl);
        if (buffer) break;
        if (attempt < 4) await new Promise((r) => setTimeout(r, 1000 * attempt));
      }
      if (!buffer) {
        console.error(`${prefix}: download failed (4 attempts)`);
        errors.push({ fileId: file.id, fileName: file.originalFileName, error: "download failed" });
        failed++;
        continue;
      }

      const parseResult = parseBkmvData(buffer);

      const matchResults = matchBkmvSuppliers(
        parseResult.supplierSummary,
        allSuppliers,
        { minConfidence: 0.6, reviewThreshold: 1.0 },
        blacklistedNames,
        smallSupplierNames
      );

      const existingResult = file.bkmvProcessingResult as BkmvProcessingResult;
      const manualOverrides = new Map<string, { matchedSupplierId: string; matchedSupplierName: string | null }>();
      if (existingResult.supplierMatches) {
        for (const oldMatch of existingResult.supplierMatches) {
          if (oldMatch.matchType === "manual" && oldMatch.matchedSupplierId) {
            manualOverrides.set(oldMatch.bkmvName, {
              matchedSupplierId: oldMatch.matchedSupplierId,
              matchedSupplierName: oldMatch.matchedSupplierName,
            });
          }
        }
      }

      const supplierIdMap = new Map<string, string | null>();
      for (const r of matchResults) {
        const manual = manualOverrides.get(r.bkmvName);
        if (manual) {
          supplierIdMap.set(r.bkmvName, manual.matchedSupplierId);
        } else {
          const isExact = r.matchResult.matchedSupplier && r.matchResult.confidence === 1;
          supplierIdMap.set(r.bkmvName, isExact ? r.matchResult.matchedSupplier!.id : null);
        }
      }

      const monthlyBreakdown = buildMonthlyBreakdown(parseResult.transactions, supplierIdMap);

      const newSupplierMatches = matchResults.map((r) => {
        const manual = manualOverrides.get(r.bkmvName);
        if (manual) {
          manualMatchesPreserved++;
          return {
            bkmvName: r.bkmvName,
            amount: r.amount,
            transactionCount: r.transactionCount,
            matchedSupplierId: manual.matchedSupplierId,
            matchedSupplierName: manual.matchedSupplierName,
            confidence: 1,
            matchType: "manual" as const,
            requiresReview: false,
          };
        }
        return {
          bkmvName: r.bkmvName,
          amount: r.amount,
          transactionCount: r.transactionCount,
          matchedSupplierId: r.matchResult.matchedSupplier?.id || null,
          matchedSupplierName: r.matchResult.matchedSupplier?.name || null,
          confidence: r.matchResult.confidence,
          matchType: r.matchResult.matchType,
          requiresReview: r.matchResult.requiresReview,
        };
      });

      const nonBlacklisted = newSupplierMatches.filter((m) => m.matchType !== "blacklisted");
      const exactMatches = nonBlacklisted.filter((m) => m.matchedSupplierId && m.confidence === 1).length;
      const fuzzyMatches = nonBlacklisted.filter((m) => m.matchedSupplierId && m.confidence < 1).length;
      const unmatched = nonBlacklisted.filter((m) => !m.matchedSupplierId).length;

      const revenueAccounts = convertRevenueSummaryToArray(parseResult.revenueSummary);
      const allAccountsMap = buildAllAccountsSummary(parseResult);
      mergeRevenueSummaryIntoAllAccounts(allAccountsMap, parseResult.revenueSummary);
      const revenueCodeSet = new Set(revenueAccounts.map((a) => a.accountCode));
      const allAccountSummaries = convertAllAccountsSummaryToArray(allAccountsMap).map((a) => ({
        ...a,
        autoDetectedAsRevenue: revenueCodeSet.has(a.accountCode),
      }));

      const confirmedCodes =
        existingResult.confirmedRevenueAccountCodes ??
        (existingResult.confirmedRevenueAccountCode ? [existingResult.confirmedRevenueAccountCode] : undefined);

      if (confirmedCodes) {
        const confirmedSet = new Set(confirmedCodes);
        for (const ra of revenueAccounts) {
          ra.isConfirmed = confirmedSet.has(ra.accountCode);
        }
      }

      const revenueMonthlyBreakdown = buildRevenueMonthlyBreakdown(parseResult.revenueSummary, confirmedCodes);

      const updatedResult: BkmvProcessingResult = {
        ...existingResult,
        supplierMatches: newSupplierMatches,
        matchStats: { total: newSupplierMatches.length, exactMatches, fuzzyMatches, unmatched },
        monthlyBreakdown,
        revenueAccounts,
        allAccountSummaries: allAccountSummaries.length > 0 ? allAccountSummaries : undefined,
        revenueMonthlyBreakdown,
      };

      await database
        .update(uploadedFile)
        .set({ bkmvProcessingResult: sql`${JSON.stringify(updatedResult)}::jsonb` })
        .where(eq(uploadedFile.id, file.id));

      if (file.franchiseeId && monthlyBreakdown) {
        await upsertFromFullBreakdown(file.franchiseeId, monthlyBreakdown, newSupplierMatches, file.id);
      }

      console.log(`${prefix}: OK (exact=${exactMatches}, fuzzy=${fuzzyMatches}, unmatched=${unmatched})`);
      processed++;
    } catch (err) {
      const e = err as { message?: string; cause?: { message?: string; code?: string }; code?: string };
      const errorMsg = e?.cause?.message || e?.message || String(err);
      const errorCode = e?.cause?.code || e?.code;
      console.error(`${prefix}: FAILED — ${errorCode ? `[${errorCode}] ` : ""}${errorMsg.slice(0, 300)}`);
      errors.push({ fileId: file.id, fileName: file.originalFileName, error: errorMsg.slice(0, 500) });
      failed++;
    }
  }

  console.log("\n=== SUMMARY ===");
  console.log(`processed: ${processed}`);
  console.log(`failed: ${failed}`);
  console.log(`manualMatchesPreserved: ${manualMatchesPreserved}`);
  if (errors.length > 0) {
    console.log("\nErrors:");
    for (const e of errors) console.log(`  - ${e.fileId} (${e.fileName}): ${e.error}`);
  }
  process.exit(failed > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error("Fatal:", err);
  process.exit(1);
});
