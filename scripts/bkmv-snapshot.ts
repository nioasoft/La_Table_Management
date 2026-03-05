/**
 * BKMV Snapshot Generator
 *
 * Runs the current bkmvdata-parser against all 18 BKMVDATA files organized by
 * accounting software type, and saves parsed results as JSON snapshots for
 * regression testing during the parser refactoring.
 *
 * Run with: npx tsx scripts/bkmv-snapshot.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import {
  parseBkmvData,
  extractDateRange,
  buildAllAccountsSummary,
  classifyAccounts,
  type BkmvParseResult,
  type BkmvTransaction,
  type BkmvAccount,
  type SupplierPurchaseSummary,
  type RevenueAccountSummary,
  type AllAccountSummary,
  type ClassifiedAccount,
} from '../src/lib/bkmvdata-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);

const INPUT_DIR = path.join(__dirname, '../raw_data/קבצים במבנה אחיד');
const OUTPUT_DIR = path.join(__dirname, '../raw_data/snapshots');

// Software type directory names
const SOFTWARE_DIRS = ['חשבשבת', 'רווחית', 'ניהול', 'לא ידוע'];

interface TransactionSnapshot {
  lineNumber: number;
  companyId: string;
  accountCode: string;
  documentNumber: string;
  description: string;
  documentDate: string; // ISO date string
  valueDate: string;    // ISO date string
  counterpartyName: string;
  side: 'debit' | 'credit';
  currency: string;
  amount: number;
  reference: string;
  accountSort: string;
  resolvedAccountKey: string;
}

interface SupplierSummarySnapshot {
  supplierName: string;
  totalAmount: number;
  transactionCount: number;
}

interface ClassificationSnapshot {
  category: string;
  classificationSource: string;
}

interface BkmvSnapshot {
  // Metadata
  fileName: string;
  softwareType: string;
  fileSizeBytes: number;
  snapshotDate: string;

  // Parse metadata
  companyId: string;
  fileVersion: string;

  // Record counts
  recordCounts: {
    total: number;
    b100: number;
    b110: number;
  };

  // Date range
  dateRange: { startDate: string; endDate: string } | null;

  // Parsed data
  transactions: TransactionSnapshot[];
  accounts: BkmvAccount[];

  // Summaries
  supplierSummary: Record<string, SupplierSummarySnapshot>;
  revenueSummary: Record<string, RevenueAccountSummary>;
  allAccountsSummary: Record<string, AllAccountSummary>;

  // Classification
  classificationResults: Record<string, ClassificationSnapshot>;

  // Errors and warnings
  errors: string[];
  warnings: string[];
}

function formatLocalDate(date: Date): string {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, '0');
  const day = String(date.getDate()).padStart(2, '0');
  return `${year}-${month}-${day}`;
}

function serializeTransaction(tx: BkmvTransaction): TransactionSnapshot {
  return {
    lineNumber: tx.lineNumber,
    companyId: tx.companyId,
    accountCode: tx.accountCode,
    documentNumber: tx.documentNumber,
    description: tx.description,
    documentDate: formatLocalDate(tx.documentDate),
    valueDate: formatLocalDate(tx.valueDate),
    counterpartyName: tx.counterpartyName,
    side: tx.side,
    currency: tx.currency,
    amount: tx.amount,
    reference: tx.reference,
    accountSort: tx.accountSort,
    resolvedAccountKey: tx.resolvedAccountKey,
  };
}

function serializeSupplierSummary(
  summary: Map<string, SupplierPurchaseSummary>
): Record<string, SupplierSummarySnapshot> {
  const result: Record<string, SupplierSummarySnapshot> = {};
  for (const [key, value] of summary) {
    result[key] = {
      supplierName: value.supplierName,
      totalAmount: value.totalAmount,
      transactionCount: value.transactionCount,
      // Omit transactions array to keep snapshots smaller
    };
  }
  return result;
}

function serializeRevenueSummary(
  summary: Map<string, RevenueAccountSummary>
): Record<string, RevenueAccountSummary> {
  const result: Record<string, RevenueAccountSummary> = {};
  for (const [key, value] of summary) {
    result[key] = { ...value };
  }
  return result;
}

function createSnapshot(
  fileName: string,
  softwareType: string,
  fileSizeBytes: number,
  parseResult: BkmvParseResult
): BkmvSnapshot {
  // Build all accounts summary
  const allAccountsSummary = buildAllAccountsSummary(parseResult);

  // Classify accounts
  const classifiedAccounts = classifyAccounts(
    allAccountsSummary instanceof Map
      ? allAccountsSummary
      : new Map(Object.entries(allAccountsSummary))
  );

  // Serialize classifications
  const classificationResults: Record<string, ClassificationSnapshot> = {};
  if (classifiedAccounts instanceof Map) {
    for (const [key, value] of classifiedAccounts) {
      classificationResults[key] = {
        category: value.category,
        classificationSource: value.classificationSource || 'auto',
      };
    }
  } else {
    for (const [key, value] of Object.entries(classifiedAccounts as Record<string, ClassifiedAccount>)) {
      classificationResults[key] = {
        category: value.category,
        classificationSource: value.classificationSource || 'auto',
      };
    }
  }

  // Extract date range
  const dateRange = extractDateRange(parseResult);

  // Serialize all accounts summary
  const serializedAllAccounts: Record<string, AllAccountSummary> = {};
  if (allAccountsSummary instanceof Map) {
    for (const [key, value] of allAccountsSummary) {
      serializedAllAccounts[key] = { ...value };
    }
  } else {
    Object.assign(serializedAllAccounts, allAccountsSummary);
  }

  return {
    fileName,
    softwareType,
    fileSizeBytes,
    snapshotDate: new Date().toISOString(),

    companyId: parseResult.companyId,
    fileVersion: parseResult.fileVersion,

    recordCounts: {
      total: parseResult.totalRecords,
      b100: parseResult.transactions.length,
      b110: parseResult.accounts.length,
    },

    dateRange: dateRange
      ? {
          startDate: formatLocalDate(dateRange.startDate),
          endDate: formatLocalDate(dateRange.endDate),
        }
      : null,

    transactions: parseResult.transactions.map(serializeTransaction),
    accounts: parseResult.accounts,

    supplierSummary: serializeSupplierSummary(parseResult.supplierSummary),
    revenueSummary: serializeRevenueSummary(parseResult.revenueSummary),
    allAccountsSummary: serializedAllAccounts,

    classificationResults,

    errors: parseResult.errors,
    warnings: parseResult.warnings,
  };
}

interface SummaryRow {
  softwareType: string;
  fileName: string;
  companyId: string;
  b100: number;
  b110: number;
  suppliers: number;
  dateRange: string;
  errors: number;
  warnings: number;
}

async function main() {
  console.log('='.repeat(70));
  console.log('BKMV Snapshot Generator');
  console.log('='.repeat(70));
  console.log();

  const summaryRows: SummaryRow[] = [];
  let totalFiles = 0;
  let successCount = 0;
  let errorCount = 0;

  for (const softwareType of SOFTWARE_DIRS) {
    const dirPath = path.join(INPUT_DIR, softwareType);
    const outputDirPath = path.join(OUTPUT_DIR, softwareType);

    // Check if directory exists
    if (!fs.existsSync(dirPath)) {
      console.log(`Directory not found: ${dirPath}`);
      continue;
    }

    // Create output directory
    fs.mkdirSync(outputDirPath, { recursive: true });

    // List files
    const files = fs.readdirSync(dirPath).filter(f => {
      const lower = f.toLowerCase();
      return lower.endsWith('.txt') || lower.endsWith('.dat');
    });

    console.log(`\n--- ${softwareType} (${files.length} files) ---`);

    for (const fileName of files) {
      totalFiles++;
      const filePath = path.join(dirPath, fileName);
      const stats = fs.statSync(filePath);

      process.stdout.write(`  Processing: ${fileName}... `);

      try {
        const buffer = fs.readFileSync(filePath);
        const parseResult = parseBkmvData(buffer);

        const snapshot = createSnapshot(
          fileName,
          softwareType,
          stats.size,
          parseResult
        );

        // Save snapshot
        const outputFileName = fileName.replace(/\.(txt|TXT|dat|DAT)$/, '.json');
        const outputPath = path.join(outputDirPath, outputFileName);
        fs.writeFileSync(outputPath, JSON.stringify(snapshot, null, 2), 'utf-8');

        const snapshotSize = fs.statSync(outputPath).size;
        console.log(
          `OK (${snapshot.recordCounts.b100} txns, ${snapshot.recordCounts.b110} accounts, ` +
          `${Object.keys(snapshot.supplierSummary).length} suppliers, ` +
          `snapshot: ${(snapshotSize / 1024).toFixed(0)}KB)`
        );

        const dateRange = snapshot.dateRange
          ? `${snapshot.dateRange.startDate} - ${snapshot.dateRange.endDate}`
          : 'N/A';

        summaryRows.push({
          softwareType,
          fileName,
          companyId: snapshot.companyId,
          b100: snapshot.recordCounts.b100,
          b110: snapshot.recordCounts.b110,
          suppliers: Object.keys(snapshot.supplierSummary).length,
          dateRange,
          errors: snapshot.errors.length,
          warnings: snapshot.warnings.length,
        });

        successCount++;
      } catch (err) {
        const message = err instanceof Error ? err.message : String(err);
        console.log(`FAILED: ${message}`);
        errorCount++;
      }
    }
  }

  // Print summary table
  console.log('\n' + '='.repeat(70));
  console.log('SUMMARY');
  console.log('='.repeat(70));
  console.log();

  // Table header
  const col = {
    type: 10,
    file: 30,
    company: 11,
    b100: 7,
    b110: 6,
    supp: 6,
    dates: 25,
    err: 4,
    warn: 5,
  };

  console.log(
    'Software'.padEnd(col.type) +
    'File'.padEnd(col.file) +
    'Company'.padEnd(col.company) +
    'B100'.padStart(col.b100) +
    'B110'.padStart(col.b110) +
    'Supp'.padStart(col.supp) +
    '  ' + 'Date Range'.padEnd(col.dates) +
    'Err'.padStart(col.err) +
    'Warn'.padStart(col.warn)
  );
  console.log('-'.repeat(col.type + col.file + col.company + col.b100 + col.b110 + col.supp + 2 + col.dates + col.err + col.warn));

  for (const row of summaryRows) {
    console.log(
      row.softwareType.substring(0, col.type - 1).padEnd(col.type) +
      row.fileName.substring(0, col.file - 1).padEnd(col.file) +
      row.companyId.padEnd(col.company) +
      String(row.b100).padStart(col.b100) +
      String(row.b110).padStart(col.b110) +
      String(row.suppliers).padStart(col.supp) +
      '  ' + row.dateRange.padEnd(col.dates) +
      String(row.errors).padStart(col.err) +
      String(row.warnings).padStart(col.warn)
    );
  }

  console.log();
  console.log(`Total: ${totalFiles} files, ${successCount} success, ${errorCount} errors`);
  console.log(`Snapshots saved to: ${OUTPUT_DIR}`);
  console.log();
}

main().catch(console.error);
