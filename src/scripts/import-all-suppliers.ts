/**
 * Import All Supplier Files Script
 *
 * This script processes all supplier files from the raw_data directory
 * and imports commissions into the database.
 *
 * Usage: npx tsx src/scripts/import-all-suppliers.ts
 */

// Load environment variables before any other imports
import "dotenv/config";

import { database as db } from "../db";
import { supplier, franchisee, commission } from "../db/schema";
import type { SupplierFileMapping, Franchisee } from "../db/schema";
import { eq, and } from "drizzle-orm";
import * as fs from "fs";
import * as path from "path";
import { processSupplierFile } from "../lib/file-processor";
import { matchFranchiseeName, type MatcherConfig } from "../lib/franchisee-matcher";
import { randomUUID } from "crypto";

// Configuration
const RAW_DATA_DIR = path.join(process.cwd(), "raw_data/raw_files_suppliers/קבצים לעמלות רשת");

// Settlement period for Q4 2024 (October-December)
const SETTLEMENT_PERIOD = {
  name: "רבעון 4 2024",
  periodType: "quarterly" as const,
  startDate: "2024-10-01",
  endDate: "2024-12-31",
};

// Mapping of file names to supplier codes
const FILE_TO_SUPPLIER_MAP: Record<string, string> = {
  "אברהמי.xlsx": "AVRAHAMI",
  "אספיריט.xlsx": "ASPIRIT",
  "אראל אריזות.xlsx": "AREL_PACKAGING",
  "ארגל.XLSX": "ARGEL",
  "דיפלומט.xlsx": "DIPLOMAT",
  "היכל הייו.xlsx": "HEICHAL_HAYIU",
  "יוניקו.xlsx": "UNICO",
  "יעקב סוכנויות.xlsx": "YAAKOV_AGENCIES",
  "מחלבות גד.xlsx": "MACHALVOT_GAD",
  "מדג.xls": "MADAG",
  "מור בריאות.xls": "MOR_BRIUT",
  "מזרח ומערב.xlsx": "MIZRACH_UMAARAV",
  "מעדני הטבע.xlsx": "MAADANEI_HATEVA",
  "מקאטי.xlsx": "MAKATI",
  "עלה עלה.csv": "ALE_ALE",
  "פאנדנגו.xlsx": "FANDANGO",
  "פרסקו.xlsx": "FRESCO",
  "קיל ביל.xlsx": "KILL_BILL",
  "רסטרטו.xlsx": "RISTRETTO",
  "תויות הצפון.xlsx": "TUVIOT_HATZAFON",
  "ג_ומון מינה טומאיי.xlsx": "JUMON",
  "ג_ומון קינג קונג.xlsx": "JUMON",
};

// Matcher config - only 100% matches are auto-accepted
const MATCHER_CONFIG: Partial<MatcherConfig> = {
  minConfidence: 0.7,
  reviewThreshold: 1.0, // Only 100% matches are auto-accepted
  includeInactive: false,
};

interface ImportResult {
  supplierName: string;
  fileName: string;
  success: boolean;
  rowsProcessed: number;
  commissionsCreated: number;
  unmatchedRows: number;
  errors: string[];
}

// Note: Settlement period creation is skipped because the DB requires franchisee_id.
// Commissions will be created without a settlement period ID - they can be linked later.
// The commission table has periodStartDate and periodEndDate for date tracking.

async function loadSuppliers(): Promise<Map<string, { id: string; name: string; rate: string; vatIncluded: boolean; fileMapping: unknown }>> {
  const suppliers = await db
    .select({
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
      defaultCommissionRate: supplier.defaultCommissionRate,
      vatIncluded: supplier.vatIncluded,
      fileMapping: supplier.fileMapping,
    })
    .from(supplier);

  const supplierMap = new Map();
  for (const s of suppliers) {
    if (s.code) {
      supplierMap.set(s.code, {
        id: s.id,
        name: s.name,
        rate: s.defaultCommissionRate || "0",
        vatIncluded: s.vatIncluded ?? true,
        fileMapping: s.fileMapping,
      });
    }
  }

  return supplierMap;
}

async function loadFranchisees(): Promise<Array<{
  id: string;
  name: string;
  code: string;
  brandId: string | null;
  isActive: boolean;
  aliases: string[] | null;
}>> {
  const franchisees = await db
    .select({
      id: franchisee.id,
      name: franchisee.name,
      code: franchisee.code,
      brandId: franchisee.brandId,
      isActive: franchisee.isActive,
      aliases: franchisee.aliases,
    })
    .from(franchisee);

  return franchisees;
}

async function processFile(
  filePath: string,
  fileName: string,
  supplierData: { id: string; name: string; rate: string; vatIncluded: boolean; fileMapping: unknown },
  franchisees: Array<{ id: string; name: string; code: string; brandId: string | null; isActive: boolean; aliases: string[] | null }>,
  supplierCode: string
): Promise<ImportResult> {
  const result: ImportResult = {
    supplierName: supplierData.name,
    fileName,
    success: false,
    rowsProcessed: 0,
    commissionsCreated: 0,
    unmatchedRows: 0,
    errors: [],
  };

  try {
    // Read file
    const fileBuffer = fs.readFileSync(filePath);

    // Process file with custom parser if available
    const fileMapping = supplierData.fileMapping || {
      columnMappings: { franchiseeColumn: "A", amountColumn: "B" },
      headerRow: 1,
      dataStartRow: 2,
    };

    const processingResult = await processSupplierFile(
      fileBuffer,
      fileMapping as SupplierFileMapping,
      supplierData.vatIncluded,
      0.18,
      supplierCode
    );

    if (!processingResult.success) {
      result.errors = processingResult.legacyErrors || processingResult.errors.map(e => e.message);
      return result;
    }

    result.rowsProcessed = processingResult.data.length;

    // Match franchisees and insert commissions
    const commissionsToInsert: Array<{
      id: string;
      supplierId: string;
      franchiseeId: string;
      periodStartDate: string;
      periodEndDate: string;
      status: "pending";
      grossAmount: string;
      netAmount: string | null;
      vatAdjusted: boolean;
      commissionRate: string;
      commissionAmount: string;
      createdAt: Date;
      updatedAt: Date;
    }> = [];

    const unmatchedNames: string[] = [];

    for (const row of processingResult.data) {
      // Match franchisee
      const matchResult = matchFranchiseeName(row.franchisee, franchisees as Franchisee[], MATCHER_CONFIG);

      if (!matchResult.matchedFranchisee) {
        unmatchedNames.push(row.franchisee);
        result.unmatchedRows++;
        continue;
      }

      // Calculate commission
      const commissionRate = parseFloat(supplierData.rate);
      const commissionAmount = (row.netAmount * commissionRate) / 100;

      commissionsToInsert.push({
        id: randomUUID(),
        supplierId: supplierData.id,
        franchiseeId: matchResult.matchedFranchisee.id,
        periodStartDate: SETTLEMENT_PERIOD.startDate,
        periodEndDate: SETTLEMENT_PERIOD.endDate,
        status: "pending",
        grossAmount: row.grossAmount.toFixed(2),
        netAmount: row.netAmount.toFixed(2),
        vatAdjusted: processingResult.summary.vatAdjusted,
        commissionRate: commissionRate.toFixed(2),
        commissionAmount: commissionAmount.toFixed(2),
        createdAt: new Date(),
        updatedAt: new Date(),
      });
    }

    // Insert commissions in batches
    if (commissionsToInsert.length > 0) {
      const batchSize = 100;
      for (let i = 0; i < commissionsToInsert.length; i += batchSize) {
        const batch = commissionsToInsert.slice(i, i + batchSize);
        await db.insert(commission).values(batch);
      }
      result.commissionsCreated = commissionsToInsert.length;
    }

    // Log unmatched names
    if (unmatchedNames.length > 0) {
      const uniqueUnmatched = [...new Set(unmatchedNames)];
      result.errors.push(`Unmatched names: ${uniqueUnmatched.join(", ")}`);
    }

    result.success = true;
    return result;
  } catch (error) {
    result.errors.push(error instanceof Error ? error.message : "Unknown error");
    return result;
  }
}

async function main() {
  console.log("=".repeat(60));
  console.log("Supplier Commission Import Script");
  console.log("=".repeat(60));
  console.log("");
  console.log(`Period: ${SETTLEMENT_PERIOD.name} (${SETTLEMENT_PERIOD.startDate} to ${SETTLEMENT_PERIOD.endDate})`);
  console.log("");

  // Load suppliers
  console.log("Loading suppliers...");
  const supplierMap = await loadSuppliers();
  console.log(`Loaded ${supplierMap.size} suppliers with codes`);
  console.log("");

  // Load franchisees
  console.log("Loading franchisees...");
  const franchisees = await loadFranchisees();
  console.log(`Loaded ${franchisees.length} franchisees`);
  console.log("");

  // List files in directory
  const files = fs.readdirSync(RAW_DATA_DIR);
  console.log(`Found ${files.length} files in directory`);
  console.log("");

  // Process each file
  const results: ImportResult[] = [];

  for (const fileName of files) {
    // Skip directories and hidden files
    const filePath = path.join(RAW_DATA_DIR, fileName);
    const stats = fs.statSync(filePath);
    if (stats.isDirectory() || fileName.startsWith(".")) {
      continue;
    }

    // Skip non-data files
    const ext = path.extname(fileName).toLowerCase();
    if (![".xlsx", ".xls", ".csv"].includes(ext)) {
      console.log(`Skipping ${fileName} (unsupported format)`);
      continue;
    }

    // Get supplier code for this file
    const supplierCode = FILE_TO_SUPPLIER_MAP[fileName];
    if (!supplierCode) {
      console.log(`Skipping ${fileName} (no supplier mapping)`);
      continue;
    }

    const supplierData = supplierMap.get(supplierCode);
    if (!supplierData) {
      console.log(`Skipping ${fileName} (supplier ${supplierCode} not found in DB)`);
      continue;
    }

    console.log(`Processing: ${fileName} -> ${supplierData.name} (${supplierCode})`);

    const result = await processFile(
      filePath,
      fileName,
      supplierData,
      franchisees,
      supplierCode
    );

    results.push(result);

    if (result.success) {
      console.log(`  ✓ ${result.rowsProcessed} rows, ${result.commissionsCreated} commissions, ${result.unmatchedRows} unmatched`);
    } else {
      console.log(`  ✗ Failed: ${result.errors.join(", ")}`);
    }
  }

  // Summary
  console.log("");
  console.log("=".repeat(60));
  console.log("IMPORT SUMMARY");
  console.log("=".repeat(60));
  console.log("");

  const successful = results.filter(r => r.success);
  const failed = results.filter(r => !r.success);

  console.log(`Total files processed: ${results.length}`);
  console.log(`Successful: ${successful.length}`);
  console.log(`Failed: ${failed.length}`);
  console.log("");

  const totalCommissions = successful.reduce((sum, r) => sum + r.commissionsCreated, 0);
  const totalUnmatched = successful.reduce((sum, r) => sum + r.unmatchedRows, 0);

  console.log(`Total commissions created: ${totalCommissions}`);
  console.log(`Total unmatched rows: ${totalUnmatched}`);
  console.log("");

  if (failed.length > 0) {
    console.log("Failed files:");
    for (const f of failed) {
      console.log(`  - ${f.fileName}: ${f.errors.join(", ")}`);
    }
    console.log("");
  }

  // Report unmatched names
  const allUnmatched: string[] = [];
  for (const r of results) {
    const unmatchedError = r.errors.find(e => e.startsWith("Unmatched names:"));
    if (unmatchedError) {
      const names = unmatchedError.replace("Unmatched names: ", "").split(", ");
      allUnmatched.push(...names);
    }
  }

  if (allUnmatched.length > 0) {
    const uniqueUnmatched = [...new Set(allUnmatched)].sort();
    console.log("All unmatched franchisee names:");
    for (const name of uniqueUnmatched) {
      console.log(`  - ${name}`);
    }
  }

  console.log("");
  console.log("Import complete!");
}

main().catch(console.error);
