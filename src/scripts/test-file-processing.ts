/**
 * End-to-end test for file processing
 *
 * Tests the full flow of processing supplier files through custom parsers
 */

import "dotenv/config";
import * as fs from "fs";
import * as path from "path";
import { database, pool } from "../db";
import { supplier } from "../db/schema";
import { eq } from "drizzle-orm";
import { processSupplierFile } from "../lib/file-processor";
import type { SupplierFileMapping } from "../db/schema";

const TEST_FILES_DIR = "raw_data/raw_files_suppliers/קבצים לעמלות רשת";

interface TestResult {
  supplierCode: string;
  supplierName: string;
  success: boolean;
  franchisees: number;
  totalNetAmount: number;
  error?: string;
}

async function testSupplierFile(
  supplierCode: string,
  filePath: string
): Promise<TestResult> {
  try {
    // Get supplier from DB
    const suppliers = await database
      .select()
      .from(supplier)
      .where(eq(supplier.code, supplierCode))
      .limit(1);

    if (suppliers.length === 0) {
      return {
        supplierCode,
        supplierName: "NOT FOUND",
        success: false,
        franchisees: 0,
        totalNetAmount: 0,
        error: `Supplier ${supplierCode} not found in database`,
      };
    }

    const sup = suppliers[0];
    const fileMapping = sup.fileMapping as SupplierFileMapping | null;

    if (!fileMapping) {
      return {
        supplierCode,
        supplierName: sup.name,
        success: false,
        franchisees: 0,
        totalNetAmount: 0,
        error: "No file mapping configured",
      };
    }

    // Read file
    const buffer = fs.readFileSync(filePath);

    // Process file
    const result = await processSupplierFile(
      buffer,
      fileMapping,
      sup.vatIncluded ?? false,
      undefined,
      supplierCode
    );

    return {
      supplierCode,
      supplierName: sup.name,
      success: result.success,
      franchisees: result.data.length,
      totalNetAmount: result.summary.totalNetAmount,
      error: result.errors.length > 0 ? result.errors[0].message : undefined,
    };
  } catch (error) {
    return {
      supplierCode,
      supplierName: "ERROR",
      success: false,
      franchisees: 0,
      totalNetAmount: 0,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

async function main() {
  console.log("=== End-to-End File Processing Test ===\n");

  const testCases: Array<{ code: string; file: string }> = [
    // Simple suppliers (files are in root of the directory)
    { code: "FANDANGO", file: `${TEST_FILES_DIR}/פאנדנגו.xlsx` },
    { code: "HEICHAL_HAYIU", file: `${TEST_FILES_DIR}/היכל הייו.xlsx` },
    { code: "MAKATI", file: `${TEST_FILES_DIR}/מקאטי.xlsx` },
    { code: "ASPIRIT", file: `${TEST_FILES_DIR}/אספיריט.xlsx` },
    { code: "FRESCO", file: `${TEST_FILES_DIR}/פרסקו.xlsx` },
    { code: "KILL_BILL", file: `${TEST_FILES_DIR}/קיל ביל.xlsx` },
    { code: "JUMON", file: `${TEST_FILES_DIR}/ג_ומון מינה טומאיי.xlsx` },
    { code: "MAADANEI_HATEVA", file: `${TEST_FILES_DIR}/מעדני הטבע.xlsx` },
    { code: "ARGEL", file: `${TEST_FILES_DIR}/ארגל.XLSX` },
    { code: "DIPLOMAT", file: `${TEST_FILES_DIR}/דיפלומט.xlsx` },
    { code: "MIZRACH_UMAARAV", file: `${TEST_FILES_DIR}/מזרח ומערב.xlsx` },
    { code: "RISTRETTO", file: `${TEST_FILES_DIR}/רסטרטו.xlsx` },
    { code: "ALE_ALE", file: `${TEST_FILES_DIR}/עלה עלה.csv` },

    // Custom parser suppliers
    { code: "MADAG", file: `${TEST_FILES_DIR}/מדג.xls` },
    { code: "AVRAHAMI", file: `${TEST_FILES_DIR}/אברהמי.xlsx` },
    { code: "YAAKOV_AGENCIES", file: `${TEST_FILES_DIR}/יעקב סוכנויות.xlsx` },
    { code: "MOR_BRIUT", file: `${TEST_FILES_DIR}/מור בריאות.xls` },
    { code: "UNICO", file: `${TEST_FILES_DIR}/יוניקו.xlsx` },
    { code: "TUVIOT_HATZAFON", file: `${TEST_FILES_DIR}/תויות הצפון.xlsx` },
    { code: "MACHALVOT_GAD", file: `${TEST_FILES_DIR}/מחלבות גד.xlsx` },
    { code: "EREL_PACKAGING", file: `${TEST_FILES_DIR}/אראל אריזות.xlsx` },
  ];

  // Test Pasta La Casa with ZIP
  const pastaLaCasaZip = "/tmp/pasta-la-casa-test.zip";
  if (fs.existsSync(pastaLaCasaZip)) {
    testCases.push({ code: "PASTA_LA_CASA", file: pastaLaCasaZip });
  }

  const results: TestResult[] = [];
  let passed = 0;
  let failed = 0;

  for (const testCase of testCases) {
    if (!fs.existsSync(testCase.file)) {
      console.log(`⏭️  ${testCase.code}: File not found - ${path.basename(testCase.file)}`);
      continue;
    }

    const result = await testSupplierFile(testCase.code, testCase.file);
    results.push(result);

    if (result.success) {
      console.log(
        `✅ ${result.supplierCode}: ${result.franchisees} franchisees, ₪${result.totalNetAmount.toLocaleString()}`
      );
      passed++;
    } else {
      console.log(`❌ ${result.supplierCode}: ${result.error}`);
      failed++;
    }
  }

  console.log("\n=== Summary ===");
  console.log(`Passed: ${passed}`);
  console.log(`Failed: ${failed}`);
  console.log(`Total: ${results.length}`);

  // Calculate total amounts
  const totalNet = results
    .filter((r) => r.success)
    .reduce((sum, r) => sum + r.totalNetAmount, 0);
  const totalFranchisees = results
    .filter((r) => r.success)
    .reduce((sum, r) => sum + r.franchisees, 0);

  console.log(`\nTotal franchisee records: ${totalFranchisees}`);
  console.log(`Total net amount: ₪${totalNet.toLocaleString()}`);

  await pool.end();
}

main().catch(console.error);
