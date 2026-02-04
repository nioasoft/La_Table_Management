/**
 * Script to find "stuck" files in uploaded_file table
 *
 * These are files that have `needs_review` status but no `bkmvProcessingResult`,
 * meaning they're supplier files that got stuck in the wrong queue before the fix.
 *
 * Run with: npx tsx scripts/find-stuck-files.ts
 *
 * Options:
 *   --fix    Create missing supplier_file_upload records for stuck supplier files
 *   --delete Delete stuck files (use with caution!)
 */

import "dotenv/config";
import { randomUUID } from "crypto";
import { database } from "../src/db";
import {
  uploadedFile,
  uploadLink,
  supplier,
  supplierFileUpload,
} from "../src/db/schema";
import { eq, and, isNull } from "drizzle-orm";

interface StuckFile {
  id: string;
  fileName: string;
  originalFileName: string;
  fileUrl: string;
  fileSize: number;
  processingStatus: string | null;
  createdAt: Date | null;
  uploadLinkId: string | null;
  entityType: string | null;
  entityId: string | null;
  entityName: string | null;
}

async function findStuckFiles(): Promise<StuckFile[]> {
  // Find all files with needs_review but no bkmvProcessingResult
  const results = await database
    .select({
      id: uploadedFile.id,
      fileName: uploadedFile.fileName,
      originalFileName: uploadedFile.originalFileName,
      fileUrl: uploadedFile.fileUrl,
      fileSize: uploadedFile.fileSize,
      processingStatus: uploadedFile.processingStatus,
      createdAt: uploadedFile.createdAt,
      uploadLinkId: uploadedFile.uploadLinkId,
      entityType: uploadLink.entityType,
      entityId: uploadLink.entityId,
    })
    .from(uploadedFile)
    .leftJoin(uploadLink, eq(uploadedFile.uploadLinkId, uploadLink.id))
    .where(
      and(
        eq(uploadedFile.processingStatus, "needs_review"),
        isNull(uploadedFile.bkmvProcessingResult)
      )
    );

  // Enrich with entity names
  const enrichedResults: StuckFile[] = [];

  for (const file of results) {
    let entityName: string | null = null;

    if (file.entityType === "supplier" && file.entityId) {
      const supplierResult = await database
        .select({ name: supplier.name })
        .from(supplier)
        .where(eq(supplier.id, file.entityId))
        .limit(1);
      entityName = supplierResult[0]?.name || null;
    }

    enrichedResults.push({
      ...file,
      entityName,
    });
  }

  return enrichedResults;
}

async function checkExistingSupplierFileUpload(fileUrl: string): Promise<boolean> {
  const existing = await database
    .select({ id: supplierFileUpload.id })
    .from(supplierFileUpload)
    .where(eq(supplierFileUpload.fileUrl, fileUrl))
    .limit(1);

  return existing.length > 0;
}

async function createMissingSupplierFileUpload(file: StuckFile): Promise<string | null> {
  if (file.entityType !== "supplier" || !file.entityId) {
    return null;
  }

  // Check if already exists
  const exists = await checkExistingSupplierFileUpload(file.fileUrl);
  if (exists) {
    return "already_exists";
  }

  // Create the record
  const [newRecord] = await database
    .insert(supplierFileUpload)
    .values({
      id: randomUUID(),
      supplierId: file.entityId,
      originalFileName: file.originalFileName,
      fileUrl: file.fileUrl,
      fileSize: file.fileSize,
      processingStatus: "needs_review",
      processingResult: null,
      periodStartDate: null,
      periodEndDate: null,
      createdBy: null,
    })
    .returning({ id: supplierFileUpload.id });

  return newRecord.id;
}

async function deleteStuckFile(fileId: string): Promise<boolean> {
  const result = await database
    .delete(uploadedFile)
    .where(eq(uploadedFile.id, fileId));

  return (result.rowCount ?? 0) > 0;
}

async function main() {
  const args = process.argv.slice(2);
  const shouldFix = args.includes("--fix");
  const shouldDelete = args.includes("--delete");

  console.log("🔍 Finding stuck files...\n");

  const stuckFiles = await findStuckFiles();

  if (stuckFiles.length === 0) {
    console.log("✅ No stuck files found!");
    process.exit(0);
  }

  console.log(`Found ${stuckFiles.length} stuck file(s):\n`);

  // Group by entity type
  const supplierFiles = stuckFiles.filter((f) => f.entityType === "supplier");
  const franchiseeFiles = stuckFiles.filter((f) => f.entityType === "franchisee");
  const otherFiles = stuckFiles.filter(
    (f) => f.entityType !== "supplier" && f.entityType !== "franchisee"
  );

  if (supplierFiles.length > 0) {
    console.log("📦 SUPPLIER FILES (should be in supplier_file_upload table):");
    console.log("─".repeat(80));
    for (const file of supplierFiles) {
      console.log(`  ID: ${file.id}`);
      console.log(`  File: ${file.originalFileName}`);
      console.log(`  Supplier: ${file.entityName || "Unknown"} (${file.entityId})`);
      console.log(`  Size: ${(file.fileSize / 1024).toFixed(1)} KB`);
      console.log(`  Created: ${file.createdAt?.toISOString() || "Unknown"}`);
      console.log(`  URL: ${file.fileUrl}`);
      console.log("");
    }
  }

  if (franchiseeFiles.length > 0) {
    console.log("🏪 FRANCHISEE FILES (may need manual review):");
    console.log("─".repeat(80));
    for (const file of franchiseeFiles) {
      console.log(`  ID: ${file.id}`);
      console.log(`  File: ${file.originalFileName}`);
      console.log(`  Franchisee ID: ${file.entityId}`);
      console.log(`  Size: ${(file.fileSize / 1024).toFixed(1)} KB`);
      console.log(`  Created: ${file.createdAt?.toISOString() || "Unknown"}`);
      console.log("");
    }
  }

  if (otherFiles.length > 0) {
    console.log("❓ OTHER FILES (unknown entity type):");
    console.log("─".repeat(80));
    for (const file of otherFiles) {
      console.log(`  ID: ${file.id}`);
      console.log(`  File: ${file.originalFileName}`);
      console.log(`  Entity Type: ${file.entityType || "None"}`);
      console.log(`  Entity ID: ${file.entityId || "None"}`);
      console.log(`  Created: ${file.createdAt?.toISOString() || "Unknown"}`);
      console.log("");
    }
  }

  // Summary
  console.log("─".repeat(80));
  console.log("SUMMARY:");
  console.log(`  Supplier files: ${supplierFiles.length}`);
  console.log(`  Franchisee files: ${franchiseeFiles.length}`);
  console.log(`  Other files: ${otherFiles.length}`);
  console.log(`  Total: ${stuckFiles.length}`);
  console.log("");

  // Fix mode
  if (shouldFix && supplierFiles.length > 0) {
    console.log("🔧 FIX MODE: Creating missing supplier_file_upload records...\n");

    let created = 0;
    let skipped = 0;
    let errors = 0;

    for (const file of supplierFiles) {
      try {
        const result = await createMissingSupplierFileUpload(file);
        if (result === "already_exists") {
          console.log(`  ⏭️  ${file.originalFileName} - already has supplier_file_upload record`);
          skipped++;
        } else if (result) {
          console.log(`  ✅ ${file.originalFileName} - created supplier_file_upload: ${result}`);
          created++;
        } else {
          console.log(`  ⚠️  ${file.originalFileName} - not a supplier file, skipped`);
          skipped++;
        }
      } catch (error) {
        console.log(`  ❌ ${file.originalFileName} - error: ${error}`);
        errors++;
      }
    }

    console.log("");
    console.log(`Fix complete: ${created} created, ${skipped} skipped, ${errors} errors`);
  }

  // Delete mode
  if (shouldDelete) {
    console.log("🗑️  DELETE MODE: Removing stuck files...\n");

    let deleted = 0;
    let errors = 0;

    for (const file of stuckFiles) {
      try {
        const success = await deleteStuckFile(file.id);
        if (success) {
          console.log(`  ✅ Deleted: ${file.originalFileName}`);
          deleted++;
        } else {
          console.log(`  ⚠️  Not found: ${file.originalFileName}`);
        }
      } catch (error) {
        console.log(`  ❌ Error deleting ${file.originalFileName}: ${error}`);
        errors++;
      }
    }

    console.log("");
    console.log(`Delete complete: ${deleted} deleted, ${errors} errors`);
  }

  // Instructions if no action taken
  if (!shouldFix && !shouldDelete) {
    console.log("ACTIONS AVAILABLE:");
    console.log("  --fix     Create missing supplier_file_upload records for supplier files");
    console.log("  --delete  Delete all stuck files from uploaded_file table");
    console.log("");
    console.log("Example:");
    console.log("  npx tsx scripts/find-stuck-files.ts --fix");
  }

  process.exit(0);
}

main().catch((error) => {
  console.error("Error:", error);
  process.exit(1);
});
