/**
 * BKMV Regression Test
 *
 * Compares the refactored parser output against saved snapshots to verify
 * that the refactoring produces identical results.
 *
 * Run with: npx tsx scripts/bkmv-regression-test.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  parseBkmvData,
  extractDateRange,
  buildAllAccountsSummary,
  classifyAccounts,
  classifyBkmvFile,
  decodeBuffer,
} from '../src/lib/bkmvdata';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_DIR = path.join(__dirname, '../raw_data/קבצים במבנה אחיד');
const SNAPSHOT_DIR = path.join(__dirname, '../raw_data/snapshots');

const SOFTWARE_DIRS = ['חשבשבת', 'רווחית', 'ניהול', 'לא ידוע'];

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

interface TestResult {
  file: string;
  softwareType: string;
  classifiedAs: string;
  passed: boolean;
  failures: string[];
}

function compareResults(
  fileName: string,
  softwareType: string,
  snapshotPath: string,
  rawFilePath: string
): TestResult {
  const failures: string[] = [];

  // Load snapshot
  const snapshot = JSON.parse(fs.readFileSync(snapshotPath, 'utf-8'));

  // Parse with new code
  const buffer = fs.readFileSync(rawFilePath);
  const result = parseBkmvData(buffer);

  // Classify
  const text = decodeBuffer(buffer);
  const classifiedAs = classifyBkmvFile(text);

  // Compare record counts
  if (result.transactions.length !== snapshot.recordCounts.b100) {
    failures.push(`B100 count: got ${result.transactions.length}, expected ${snapshot.recordCounts.b100}`);
  }
  if (result.accounts.length !== snapshot.recordCounts.b110) {
    failures.push(`B110 count: got ${result.accounts.length}, expected ${snapshot.recordCounts.b110}`);
  }
  if (result.totalRecords !== snapshot.recordCounts.total) {
    failures.push(`Total records: got ${result.totalRecords}, expected ${snapshot.recordCounts.total}`);
  }

  // Compare company ID
  if (result.companyId !== snapshot.companyId) {
    failures.push(`Company ID: got "${result.companyId}", expected "${snapshot.companyId}"`);
  }

  // Compare date range
  const dateRange = extractDateRange(result);
  if (snapshot.dateRange) {
    if (!dateRange) {
      failures.push('Date range: got null, expected value');
    } else {
      const startDate = formatLocalDate(dateRange.startDate);
      const endDate = formatLocalDate(dateRange.endDate);
      if (startDate !== snapshot.dateRange.startDate) {
        failures.push(`Start date: got "${startDate}", expected "${snapshot.dateRange.startDate}"`);
      }
      if (endDate !== snapshot.dateRange.endDate) {
        failures.push(`End date: got "${endDate}", expected "${snapshot.dateRange.endDate}"`);
      }
    }
  }

  // Compare supplier summary
  const newSupplierKeys = Array.from(result.supplierSummary.keys()).sort();
  const snapshotSupplierKeys = Object.keys(snapshot.supplierSummary).sort();
  if (newSupplierKeys.length !== snapshotSupplierKeys.length) {
    failures.push(`Supplier count: got ${newSupplierKeys.length}, expected ${snapshotSupplierKeys.length}`);
  }

  // Compare supplier amounts (top 10 by amount)
  const sortedNewSuppliers = Array.from(result.supplierSummary.entries())
    .sort((a, b) => Math.abs(b[1].totalAmount) - Math.abs(a[1].totalAmount))
    .slice(0, 10);

  for (const [name, data] of sortedNewSuppliers) {
    const snapshotData = snapshot.supplierSummary[name];
    if (!snapshotData) {
      failures.push(`Supplier "${name}" not found in snapshot`);
      continue;
    }
    if (Math.abs(data.totalAmount - snapshotData.totalAmount) > 0.01) {
      failures.push(`Supplier "${name}" amount: got ${data.totalAmount.toFixed(2)}, expected ${snapshotData.totalAmount.toFixed(2)}`);
    }
    if (data.transactionCount !== snapshotData.transactionCount) {
      failures.push(`Supplier "${name}" txn count: got ${data.transactionCount}, expected ${snapshotData.transactionCount}`);
    }
  }

  // Compare revenue summary
  const newRevenueKeys = Array.from(result.revenueSummary.keys()).sort();
  const snapshotRevenueKeys = Object.keys(snapshot.revenueSummary).sort();
  if (newRevenueKeys.length !== snapshotRevenueKeys.length) {
    failures.push(`Revenue account count: got ${newRevenueKeys.length}, expected ${snapshotRevenueKeys.length}`);
  }

  for (const key of newRevenueKeys) {
    const newRev = result.revenueSummary.get(key)!;
    const snapRev = snapshot.revenueSummary[key];
    if (!snapRev) {
      failures.push(`Revenue "${key}" not found in snapshot`);
      continue;
    }
    if (Math.abs(newRev.totalAmount - snapRev.totalAmount) > 0.01) {
      failures.push(`Revenue "${key}" amount: got ${newRev.totalAmount.toFixed(2)}, expected ${snapRev.totalAmount.toFixed(2)}`);
    }
  }

  // Compare all accounts summary
  const allAccounts = buildAllAccountsSummary(result);
  const newAllKeys = Array.from(allAccounts.keys()).sort();
  const snapshotAllKeys = Object.keys(snapshot.allAccountsSummary).sort();
  if (newAllKeys.length !== snapshotAllKeys.length) {
    failures.push(`All accounts count: got ${newAllKeys.length}, expected ${snapshotAllKeys.length}`);
  }

  // Compare classification results
  const classified = classifyAccounts(allAccounts);
  const newClassKeys = Array.from(classified.keys()).sort();
  const snapshotClassKeys = Object.keys(snapshot.classificationResults).sort();
  if (newClassKeys.length !== snapshotClassKeys.length) {
    failures.push(`Classification count: got ${newClassKeys.length}, expected ${snapshotClassKeys.length}`);
  }

  // Sample transaction comparison (first 5)
  for (let i = 0; i < Math.min(5, result.transactions.length); i++) {
    const newTx = result.transactions[i];
    const snapTx = snapshot.transactions[i];
    if (!snapTx) continue;

    if (newTx.counterpartyName !== snapTx.counterpartyName) {
      failures.push(`Tx[${i}] counterparty: got "${newTx.counterpartyName}", expected "${snapTx.counterpartyName}"`);
    }
    if (Math.abs(newTx.amount - snapTx.amount) > 0.01) {
      failures.push(`Tx[${i}] amount: got ${newTx.amount}, expected ${snapTx.amount}`);
    }
  }

  // Compare errors and warnings count
  if (result.errors.length !== snapshot.errors.length) {
    failures.push(`Errors count: got ${result.errors.length}, expected ${snapshot.errors.length}`);
  }
  if (result.warnings.length !== snapshot.warnings.length) {
    failures.push(`Warnings count: got ${result.warnings.length}, expected ${snapshot.warnings.length}`);
  }

  return {
    file: fileName,
    softwareType,
    classifiedAs,
    passed: failures.length === 0,
    failures,
  };
}

async function main() {
  console.log('='.repeat(70));
  console.log('BKMV Regression Test');
  console.log('='.repeat(70));
  console.log();

  const results: TestResult[] = [];
  let totalFiles = 0;
  let passCount = 0;
  let failCount = 0;

  for (const softwareType of SOFTWARE_DIRS) {
    const dirPath = path.join(INPUT_DIR, softwareType);
    const snapshotDirPath = path.join(SNAPSHOT_DIR, softwareType);

    if (!fs.existsSync(dirPath) || !fs.existsSync(snapshotDirPath)) continue;

    const files = fs.readdirSync(dirPath).filter(f => {
      const lower = f.toLowerCase();
      return lower.endsWith('.txt') || lower.endsWith('.dat');
    });

    for (const fileName of files) {
      totalFiles++;
      const rawFilePath = path.join(dirPath, fileName);
      const snapshotFileName = fileName.replace(/\.(txt|TXT|dat|DAT)$/, '.json');
      const snapshotPath = path.join(snapshotDirPath, snapshotFileName);

      if (!fs.existsSync(snapshotPath)) {
        console.log(`  SKIP: ${fileName} (no snapshot)`);
        continue;
      }

      process.stdout.write(`  Testing: ${fileName}... `);

      try {
        const result = compareResults(fileName, softwareType, snapshotPath, rawFilePath);
        results.push(result);

        if (result.passed) {
          console.log(`PASS (classified: ${result.classifiedAs})`);
          passCount++;
        } else {
          console.log(`FAIL (${result.failures.length} failures, classified: ${result.classifiedAs})`);
          for (const f of result.failures) {
            console.log(`    - ${f}`);
          }
          failCount++;
        }
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`ERROR: ${message}`);
        failCount++;
      }
    }
  }

  // Summary
  console.log();
  console.log('='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log(`Total: ${totalFiles} files, ${passCount} passed, ${failCount} failed`);
  console.log();

  // Classification summary
  console.log('Classification Results:');
  const classMap = new Map<string, string[]>();
  for (const r of results) {
    if (!classMap.has(r.classifiedAs)) classMap.set(r.classifiedAs, []);
    classMap.get(r.classifiedAs)!.push(`${r.softwareType}/${r.file}`);
  }
  for (const [type, files] of classMap) {
    console.log(`  ${type}: ${files.length} files`);
    for (const f of files) {
      console.log(`    - ${f}`);
    }
  }

  if (failCount > 0) {
    process.exit(1);
  }
}

main().catch(console.error);
