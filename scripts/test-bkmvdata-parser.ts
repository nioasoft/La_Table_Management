/**
 * Test script for BKMVDATA parser
 * Run with: npx tsx scripts/test-bkmvdata-parser.ts
 */

import * as fs from 'fs';
import * as path from 'path';
import { fileURLToPath } from 'url';
import { parseBkmvData, formatAmount, getUniqueSupplierNames } from '../src/lib/bkmvdata-parser';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const BKMVDATA_PATH = path.join(__dirname, '../raw_data/BKMVDATA.txt');

async function main() {
  console.log('='.repeat(60));
  console.log('BKMVDATA Parser Test');
  console.log('='.repeat(60));
  console.log();

  // Read the file
  const buffer = fs.readFileSync(BKMVDATA_PATH);
  console.log(`File size: ${(buffer.length / 1024).toFixed(1)} KB`);
  console.log();

  // Parse the file
  console.log('Parsing...');
  const result = parseBkmvData(buffer);

  // Display results
  console.log('='.repeat(60));
  console.log('PARSE RESULTS');
  console.log('='.repeat(60));
  console.log(`Company ID: ${result.companyId}`);
  console.log(`File Version: ${result.fileVersion}`);
  console.log(`Total Records: ${result.totalRecords}`);
  console.log(`Transactions (B100): ${result.transactions.length}`);
  console.log(`Accounts (B110): ${result.accounts.length}`);
  console.log(`Unique Suppliers: ${result.supplierSummary.size}`);
  console.log();

  // Display errors/warnings
  if (result.errors.length > 0) {
    console.log('ERRORS:');
    result.errors.forEach(e => console.log(`  - ${e}`));
    console.log();
  }

  if (result.warnings.length > 0 && result.warnings.length < 10) {
    console.log('WARNINGS:');
    result.warnings.forEach(w => console.log(`  - ${w}`));
    console.log();
  } else if (result.warnings.length >= 10) {
    console.log(`WARNINGS: ${result.warnings.length} warnings (too many to display)`);
    console.log();
  }

  // Display sample transactions
  console.log('='.repeat(60));
  console.log('SAMPLE TRANSACTIONS (First 5)');
  console.log('='.repeat(60));

  result.transactions.slice(0, 5).forEach((tx, i) => {
    console.log(`${i + 1}. ${tx.description}`);
    console.log(`   Counterparty: ${tx.counterpartyName}`);
    console.log(`   Amount: ${formatAmount(tx.amount)} (${tx.side})`);
    console.log(`   Date: ${tx.documentDate.toISOString().split('T')[0]}`);
    console.log();
  });

  // Display supplier summary (top 20 by amount)
  console.log('='.repeat(60));
  console.log('TOP 20 SUPPLIERS BY AMOUNT');
  console.log('='.repeat(60));

  const sortedSuppliers = Array.from(result.supplierSummary.entries())
    .sort((a, b) => b[1].totalAmount - a[1].totalAmount)
    .slice(0, 20);

  let totalPurchases = 0;
  sortedSuppliers.forEach(([name, summary], i) => {
    console.log(`${(i + 1).toString().padStart(2)}. ${name.padEnd(35)} ${formatAmount(summary.totalAmount).padStart(15)} (${summary.transactionCount} transactions)`);
    totalPurchases += summary.totalAmount;
  });

  console.log('='.repeat(60));
  console.log(`Total purchases (top 20): ${formatAmount(totalPurchases)}`);
  console.log();

  // Display all unique supplier names
  console.log('='.repeat(60));
  console.log('ALL UNIQUE SUPPLIER NAMES');
  console.log('='.repeat(60));

  const allSupplierNames = getUniqueSupplierNames(result);
  allSupplierNames.forEach((name, i) => {
    const summary = result.supplierSummary.get(name);
    console.log(`${(i + 1).toString().padStart(3)}. ${name}: ${formatAmount(summary?.totalAmount || 0)}`);
  });

  console.log();
  console.log('='.repeat(60));
  console.log('TEST COMPLETE');
  console.log('='.repeat(60));
}

main().catch(console.error);
