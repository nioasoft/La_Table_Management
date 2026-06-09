/**
 * One-off: remove a wrong manual supplier match from a BKMV file's processing result.
 *
 * Background: a per-file manual match is stored in
 * uploaded_file.bkmv_processing_result.supplierMatches (matchType="manual").
 * Deleting the supplier's bkmvAliases does NOT clear it — the review table
 * reads the file's stored match. There was no UI to "unmatch" (now added).
 *
 * This mirrors the PATCH { unmatch:true } handler, scoped to one file:
 * reverts the supplierMatches row to no_match, nulls the supplierId in
 * monthlyBreakdown, AND re-archives to the year table. (Earlier this skipped
 * re-archiving on the false assumption the year table was already clean — it
 * wasn't: franchisee_bkmv_year derives supplier_matches from monthly_breakdown,
 * so a stale supplierId there leaves a phantom in the matches report.)
 * Does not touch supplier aliases.
 *
 * Usage:
 *   npx tsx scripts/unmatch-bkmv-name.ts --file-id <uuid> --name "<bkmvName>" [--dry-run]
 */

import "dotenv/config";
import { getUploadedFileById, updateUploadedFileProcessingStatus } from "../src/data-access/uploadLinks";
import { upsertFromFullBreakdown } from "../src/data-access/franchisee-bkmv-year";
import type { BkmvProcessingResult } from "../src/db/schema";

function arg(flag: string): string | undefined {
  const i = process.argv.indexOf(flag);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main() {
  const fileId = arg("--file-id");
  const name = arg("--name");
  const dryRun = process.argv.includes("--dry-run");

  if (!fileId || !name) {
    console.error('Usage: npx tsx scripts/unmatch-bkmv-name.ts --file-id <uuid> --name "<bkmvName>" [--dry-run]');
    process.exit(1);
  }

  const file = await getUploadedFileById(fileId);
  if (!file) {
    console.error(`File not found: ${fileId}`);
    process.exit(1);
  }

  const result = file.bkmvProcessingResult as BkmvProcessingResult | null;
  if (!result) {
    console.error("File has no bkmvProcessingResult");
    process.exit(1);
  }

  const target = result.supplierMatches.find((m) => m.bkmvName === name);
  if (!target) {
    console.error(`No supplierMatches row with bkmvName="${name}"`);
    process.exit(1);
  }

  console.log("Before:", JSON.stringify({
    bkmvName: target.bkmvName,
    matchedSupplierId: target.matchedSupplierId,
    matchedSupplierName: target.matchedSupplierName,
    matchType: target.matchType,
  }, null, 2));

  // Clear the match (mirror PATCH unmatch branch)
  const updatedMatches = result.supplierMatches.map((m) =>
    m.bkmvName === name
      ? { ...m, matchedSupplierId: null, matchedSupplierName: null, confidence: 0, matchType: "no_match", requiresReview: true }
      : m
  );

  // Null the supplierId for this name across monthlyBreakdown
  let updatedMonthly = result.monthlyBreakdown;
  if (updatedMonthly) {
    const rebuilt: typeof updatedMonthly = {};
    for (const [month, entries] of Object.entries(updatedMonthly)) {
      rebuilt[month] = entries.map((e) =>
        e.supplierName === name ? { ...e, supplierId: null } : e
      );
    }
    updatedMonthly = rebuilt;
  }

  // Recompute stats
  const exactMatches = updatedMatches.filter((m) => m.matchedSupplierId && m.confidence === 1).length;
  const fuzzyMatches = updatedMatches.filter((m) => m.matchedSupplierId && m.confidence < 1).length;
  const unmatched = updatedMatches.filter((m) => !m.matchedSupplierId && m.matchType !== "blacklisted" && m.matchType !== "small_supplier").length;

  const updatedResult: BkmvProcessingResult = {
    ...result,
    supplierMatches: updatedMatches,
    monthlyBreakdown: updatedMonthly,
    matchStats: { total: updatedMatches.length, exactMatches, fuzzyMatches, unmatched },
  };

  if (dryRun) {
    console.log("[DRY RUN] Would clear the match. New matchStats:", updatedResult.matchStats);
    return;
  }

  await updateUploadedFileProcessingStatus(
    fileId,
    file.processingStatus as "pending" | "processing" | "auto_approved" | "needs_review" | "approved" | "rejected",
    updatedResult
  );

  // Re-archive so the year table (and the matches report it feeds) drops the match.
  if (file.franchiseeId && updatedMonthly) {
    await upsertFromFullBreakdown(
      file.franchiseeId,
      updatedMonthly,
      updatedResult.supplierMatches,
      fileId
    );
    console.log("   ↳ re-archived to franchisee_bkmv_year");
  }

  console.log(`✅ Cleared match for "${name}" on file ${fileId}. New matchStats:`, updatedResult.matchStats);
}

main().then(() => process.exit(0)).catch((e) => {
  console.error(e);
  process.exit(1);
});
