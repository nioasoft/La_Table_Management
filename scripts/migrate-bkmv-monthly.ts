/**
 * Migration script for adding monthlyBreakdown to existing BKMVDATA files
 *
 * This script:
 * 1. Finds all uploaded files with bkmvProcessingResult
 * 2. Downloads each original file from storage (Vercel Blob or S3)
 * 3. Re-parses to extract monthly breakdown
 * 4. Updates the JSON with monthlyBreakdown
 *
 * Run with: npx tsx scripts/migrate-bkmv-monthly.ts
 *
 * Options:
 *   --dry-run    Show what would be updated without making changes
 *   --limit=N    Process only first N files
 *   --file-id=X  Process only a specific file by ID
 */

import "dotenv/config";
import { database } from "../src/db";
import { uploadedFile, type BkmvProcessingResult } from "../src/db/schema";
import { eq, isNotNull, and } from "drizzle-orm";
import { parseBkmvData, buildMonthlyBreakdown } from "../src/lib/bkmvdata-parser";
import { matchBkmvSuppliers } from "../src/lib/supplier-matcher";
import { getSuppliers } from "../src/data-access/suppliers";
import { getBlacklistedNamesSet } from "../src/data-access/bkmvBlacklist";

// Parse command line args
const args = process.argv.slice(2);
const dryRun = args.includes("--dry-run");
const limitArg = args.find(a => a.startsWith("--limit="));
const limit = limitArg ? parseInt(limitArg.split("=")[1], 10) : undefined;
const fileIdArg = args.find(a => a.startsWith("--file-id="));
const fileId = fileIdArg ? fileIdArg.split("=")[1] : undefined;

/**
 * Download file from URL (works with Vercel Blob and other public URLs)
 */
async function downloadFile(fileUrl: string): Promise<Buffer | null> {
  try {
    const response = await fetch(fileUrl);

    if (!response.ok) {
      console.error(`Failed to download: ${response.status} ${response.statusText}`);
      return null;
    }

    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error(`Failed to download from URL: ${fileUrl}`, error);
    return null;
  }
}

async function migrateFile(
  file: {
    id: string;
    fileUrl: string | null;
    originalFileName: string;
    bkmvProcessingResult: BkmvProcessingResult;
  },
  allSuppliers: Awaited<ReturnType<typeof getSuppliers>>,
  blacklistedNames: Set<string>
): Promise<{ success: boolean; hasBreakdown: boolean; monthCount?: number; error?: string }> {
  // Check if already has monthlyBreakdown
  if (file.bkmvProcessingResult.monthlyBreakdown) {
    return { success: true, hasBreakdown: true, monthCount: Object.keys(file.bkmvProcessingResult.monthlyBreakdown).length };
  }

  if (!file.fileUrl) {
    return { success: false, hasBreakdown: false, error: "No file URL" };
  }

  // Download the original file
  const buffer = await downloadFile(file.fileUrl);
  if (!buffer) {
    return { success: false, hasBreakdown: false, error: "Failed to download file" };
  }

  // Parse the BKMVDATA file
  let parseResult;
  try {
    parseResult = parseBkmvData(buffer);
  } catch (parseError) {
    return {
      success: false,
      hasBreakdown: false,
      error: `Parse error: ${parseError instanceof Error ? parseError.message : "Unknown"}`,
    };
  }

  // Match suppliers to get IDs
  const matchResults = matchBkmvSuppliers(
    parseResult.supplierSummary,
    allSuppliers,
    { minConfidence: 0.6, reviewThreshold: 1.0 },
    blacklistedNames
  );

  // Build supplier ID map
  const supplierIdMap = new Map<string, string | null>();
  for (const r of matchResults) {
    supplierIdMap.set(r.bkmvName, r.matchResult.matchedSupplier?.id || null);
  }

  // Build monthly breakdown
  const monthlyBreakdown = buildMonthlyBreakdown(parseResult.transactions, supplierIdMap);
  const monthCount = Object.keys(monthlyBreakdown).length;

  if (monthCount === 0) {
    return { success: false, hasBreakdown: false, error: "No monthly data extracted" };
  }

  if (dryRun) {
    return { success: true, hasBreakdown: false, monthCount };
  }

  // Update the database
  try {
    const updatedResult: BkmvProcessingResult = {
      ...file.bkmvProcessingResult,
      monthlyBreakdown,
    };

    await database
      .update(uploadedFile)
      .set({ bkmvProcessingResult: updatedResult })
      .where(eq(uploadedFile.id, file.id));

    return { success: true, hasBreakdown: false, monthCount };
  } catch (updateError) {
    return {
      success: false,
      hasBreakdown: false,
      error: `Update error: ${updateError instanceof Error ? updateError.message : "Unknown"}`,
    };
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("BKMV Monthly Breakdown Migration");
  console.log("=".repeat(60));
  console.log();

  if (dryRun) {
    console.log("DRY RUN MODE - No changes will be made");
    console.log();
  }

  // Get suppliers and blacklist once
  console.log("Loading suppliers and blacklist...");
  const allSuppliers = await getSuppliers();
  const blacklistedNames = await getBlacklistedNamesSet();
  console.log(`Found ${allSuppliers.length} suppliers, ${blacklistedNames.size} blacklisted names`);
  console.log();

  // Build query conditions
  const conditions = [isNotNull(uploadedFile.bkmvProcessingResult)];

  if (fileId) {
    conditions.push(eq(uploadedFile.id, fileId));
    console.log(`Processing single file: ${fileId}`);
  }

  // Get all files with bkmvProcessingResult
  console.log("Finding BKMVDATA files...");
  let query = database
    .select({
      id: uploadedFile.id,
      fileUrl: uploadedFile.fileUrl,
      originalFileName: uploadedFile.originalFileName,
      bkmvProcessingResult: uploadedFile.bkmvProcessingResult,
    })
    .from(uploadedFile)
    .where(and(...conditions))
    .$dynamic();

  if (limit) {
    query = query.limit(limit);
    console.log(`Limiting to ${limit} files`);
  }

  const files = await query;
  console.log(`Found ${files.length} files to process`);
  console.log();

  // Process stats
  const stats = {
    total: files.length,
    alreadyHasBreakdown: 0,
    migrated: 0,
    failed: 0,
    errors: [] as { fileName: string; error: string }[],
  };

  // Process each file
  for (let i = 0; i < files.length; i++) {
    const file = files[i];
    const result = file.bkmvProcessingResult as BkmvProcessingResult;

    if (!result) {
      console.log(`[${i + 1}/${files.length}] ${file.originalFileName} - SKIP: No processing result`);
      stats.failed++;
      continue;
    }

    process.stdout.write(`[${i + 1}/${files.length}] ${file.originalFileName}... `);

    const migrationResult = await migrateFile(
      { ...file, bkmvProcessingResult: result },
      allSuppliers,
      blacklistedNames
    );

    if (migrationResult.hasBreakdown) {
      console.log(`SKIP: Already has monthlyBreakdown (${migrationResult.monthCount} months)`);
      stats.alreadyHasBreakdown++;
    } else if (migrationResult.success) {
      console.log(`OK: Added ${migrationResult.monthCount} months`);
      stats.migrated++;
    } else {
      console.log(`FAIL: ${migrationResult.error}`);
      stats.failed++;
      stats.errors.push({ fileName: file.originalFileName, error: migrationResult.error || "Unknown" });
    }
  }

  // Summary
  console.log();
  console.log("=".repeat(60));
  console.log("MIGRATION SUMMARY");
  console.log("=".repeat(60));
  console.log(`Total files processed: ${stats.total}`);
  console.log(`Already had breakdown:  ${stats.alreadyHasBreakdown}`);
  console.log(`Successfully migrated:  ${stats.migrated}`);
  console.log(`Failed:                 ${stats.failed}`);

  if (stats.errors.length > 0 && stats.errors.length <= 10) {
    console.log();
    console.log("Errors:");
    stats.errors.forEach((e) => {
      console.log(`  - ${e.fileName}: ${e.error}`);
    });
  }

  if (dryRun) {
    console.log();
    console.log("This was a dry run. Run without --dry-run to apply changes.");
  }

  console.log();
  console.log("Done!");
  process.exit(0);
}

main().catch((error) => {
  console.error("Migration failed:", error);
  process.exit(1);
});
