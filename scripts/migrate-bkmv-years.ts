/**
 * One-time migration: populate franchisee_bkmv_year from existing uploaded_file records.
 * Run with: npx dotenv -e .env -- tsx scripts/migrate-bkmv-years.ts
 */

import { database } from '../src/db';
import { uploadedFile, franchiseeBkmvYear, type BkmvProcessingResult } from '../src/db/schema';
import { isNotNull, asc } from 'drizzle-orm';
import { upsertFromFullBreakdown } from '../src/data-access/franchisee-bkmv-year';

async function migrate() {
  const files = await database
    .select({
      id: uploadedFile.id,
      franchiseeId: uploadedFile.franchiseeId,
      bkmvProcessingResult: uploadedFile.bkmvProcessingResult,
      originalFileName: uploadedFile.originalFileName,
      createdAt: uploadedFile.createdAt,
    })
    .from(uploadedFile)
    .where(isNotNull(uploadedFile.bkmvProcessingResult))
    .orderBy(asc(uploadedFile.createdAt));

  console.log('Total BKMV files:', files.length);

  let processed = 0;
  let skipped = 0;
  let noBreakdown = 0;
  const errors: string[] = [];
  const yearsSeen = new Set<string>();

  for (const file of files) {
    if (!file.franchiseeId) {
      skipped++;
      continue;
    }
    const bkmvResult = file.bkmvProcessingResult as BkmvProcessingResult;
    if (!bkmvResult.monthlyBreakdown) {
      noBreakdown++;
      continue;
    }

    try {
      const result = await upsertFromFullBreakdown(
        file.franchiseeId,
        bkmvResult.monthlyBreakdown,
        bkmvResult.supplierMatches || null,
        file.id,
        { forceOverwrite: true }
      );
      for (const y of result.updated) yearsSeen.add(file.franchiseeId + ':' + y);
      processed++;
    } catch (err: unknown) {
      const msg = err instanceof Error ? err.message : String(err);
      errors.push(file.id + ': ' + msg);
    }
  }

  console.log('Processed:', processed);
  console.log('Skipped (no franchisee):', skipped);
  console.log('No breakdown:', noBreakdown);
  console.log('Unique franchisee:year combos:', yearsSeen.size);
  console.log('Errors:', errors.length);
  if (errors.length) console.log(errors.slice(0, 5));

  // Check results
  const rows = await database.select().from(franchiseeBkmvYear);
  console.log('\nYear records created:', rows.length);
  for (const r of rows) {
    console.log('  Franchisee:', r.franchiseeId, 'Year:', r.year, 'Months:', r.monthCount, 'Complete:', r.isComplete);
  }

  process.exit(0);
}

migrate().catch(e => { console.error(e); process.exit(1); });
