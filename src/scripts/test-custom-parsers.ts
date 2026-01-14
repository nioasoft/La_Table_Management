/**
 * Test custom parsers with sample files
 * Run with: npx tsx src/scripts/test-custom-parsers.ts
 */

import * as fs from "fs";
import * as path from "path";
import { parseMadagFile } from "../lib/custom-parsers/madag-parser";
import { parseAvrahamiFile } from "../lib/custom-parsers/avrahami-parser";
import { parseYaakovAgenciesFile } from "../lib/custom-parsers/yaakov-agencies-parser";
import { parseMorBriutFile } from "../lib/custom-parsers/mor-briut-parser";

const BASE_PATH = "raw_data/raw_files_suppliers/קבצים לעמלות רשת";

interface TestCase {
  name: string;
  file: string;
  parser: (buffer: Buffer) => import("../lib/file-processor").FileProcessingResult;
}

const testCases: TestCase[] = [
  {
    name: "מדג",
    file: "מדג.xls",
    parser: parseMadagFile,
  },
  {
    name: "אברהמי",
    file: "אברהמי.xlsx",
    parser: parseAvrahamiFile,
  },
  {
    name: "יעקב סוכנויות",
    file: "יעקב סוכנויות.xlsx",
    parser: parseYaakovAgenciesFile,
  },
  {
    name: "מור בריאות",
    file: "מור בריאות.xls",
    parser: parseMorBriutFile,
  },
];

async function runTests() {
  console.log("Testing Custom Parsers");
  console.log("=".repeat(60));
  console.log("");

  for (const testCase of testCases) {
    console.log(`\n${"=".repeat(60)}`);
    console.log(`Testing: ${testCase.name}`);
    console.log(`File: ${testCase.file}`);
    console.log("=".repeat(60));

    const filePath = path.join(BASE_PATH, testCase.file);

    // Check if file exists
    if (!fs.existsSync(filePath)) {
      console.log(`❌ File not found: ${filePath}`);
      continue;
    }

    try {
      const buffer = fs.readFileSync(filePath);
      const result = testCase.parser(buffer);

      console.log(`\nSuccess: ${result.success ? "✅" : "❌"}`);
      console.log(`\nSummary:`);
      console.log(`  Total rows: ${result.summary.totalRows}`);
      console.log(`  Processed: ${result.summary.processedRows}`);
      console.log(`  Skipped: ${result.summary.skippedRows}`);
      console.log(`  Total Net Amount: ₪${result.summary.totalNetAmount.toLocaleString()}`);
      console.log(`  Total Gross Amount: ₪${result.summary.totalGrossAmount.toLocaleString()}`);

      if (result.errors.length > 0) {
        console.log(`\n❌ Errors (${result.errors.length}):`);
        result.errors.forEach((e) => console.log(`  - ${e.message}`));
      }

      if (result.warnings.length > 0) {
        console.log(`\n⚠️ Warnings (${result.warnings.length}):`);
        result.warnings.slice(0, 5).forEach((w) => console.log(`  - ${w.message}`));
        if (result.warnings.length > 5) {
          console.log(`  ... and ${result.warnings.length - 5} more`);
        }
      }

      if (result.data.length > 0) {
        console.log(`\nExtracted Data (${result.data.length} franchisees):`);
        console.log("-".repeat(50));

        // Sort by amount descending
        const sorted = [...result.data].sort((a, b) => b.netAmount - a.netAmount);

        sorted.forEach((row, idx) => {
          console.log(
            `  ${(idx + 1).toString().padStart(2)}. ${row.franchisee.padEnd(35)} ₪${row.netAmount.toLocaleString()}`
          );
        });
      }
    } catch (error) {
      console.log(`❌ Error: ${error instanceof Error ? error.message : "Unknown error"}`);
    }
  }

  console.log("\n" + "=".repeat(60));
  console.log("Testing Complete");
  console.log("=".repeat(60));
}

runTests();
