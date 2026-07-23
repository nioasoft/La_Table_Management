/**
 * One-off CLI: fix Q2-2026 מזרח ומערב + סובר לרנר after parser + alias fixes.
 *
 * Background (Reut, 2026-07-23):
 * 1. mizrach-umaarav-parser dropped negative rows — the -13,383.9 credit line
 *    of אטפה בע"מ (old legal entity of קינג קונג רעננה, customer 105977) was
 *    silently discarded, so רעננה was over-credited (parser fixed: negatives kept).
 * 2. sober-lerner-parser missed the ASCII-quoted סה"כ totals row — its 3,085
 *    commission was forward-filled onto קינג נהריה (180 → 3,265). Parser fixed.
 * 3. Polluted aliases misrouted King Kong branches:
 *    - קינג קונג כרמיאל carried מוצקין + ביג aliases → their amounts landed on כרמיאל
 *    - קינג געתון carried "קינג מוצקין" → מוצקין's sober amounts landed on געתון
 *    ("קינג נהריה" → געתון is CORRECT — געתון is the Nahariya branch.)
 *
 * This script:
 *   a. Moves the wrong aliases to the right franchisees.
 *   b. Adds the old-entity alias to קינג קונג רעננה so the credit row matches.
 *   c. Reprocesses both approved Q2 files (re-parse with fixed parsers + rematch).
 *   d. Runs syncCommissionsFromUpload for both.
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/fix-mizrach-sober-q2-2026.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import {
  commission,
  franchisee,
  supplierFileUpload,
  type SupplierFileProcessingResult,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { reprocessSupplierFileById } from "@/data-access/supplier-file-reprocess";
import { syncCommissionsFromUpload } from "@/data-access/supplier-file-uploads";

const MIZRACH_FILE_ID = "df8ca30e-3974-4c24-9e54-7e888ca7b5fb";
const SOBER_FILE_ID = "7d7d5f98-f267-465d-925a-5fd60966917e";
// Reut — owner of the original upload reviews (same as fix-mizrach-q1-2026.ts)
const REVIEWER_USER_ID = "YeUolzuyyTtH7d7bXEHeGIR3GewDlSE8";

const KARMIEL_ID = "f197a539-257a-44b7-9eb4-25e919515217";
const GAATON_ID = "e462000c-4135-4dce-a8cb-24760e92a35e";
const MOTZKIN_ID = "4b491588-72aa-43ea-8f55-9cd814e6d503";
const BIG_ID = "326aaeda-bed8-4d89-b1bf-d1467b440b61";
const RAANANA_ID = "748cdbf5-a228-42c5-b447-6bf10a8e3111";

const ALIAS_REMOVALS: Array<{ franchiseeId: string; label: string; remove: string[] }> = [
  {
    franchiseeId: KARMIEL_ID,
    label: "קינג קונג כרמיאל",
    remove: ['קינג קונג מוצקין', 'קינג קונג - קרית מוצקין', 'קינג קונג מוצקין בע"מ', "קינג ביג"],
  },
  {
    franchiseeId: GAATON_ID,
    label: "קינג געתון",
    remove: ["קינג מוצקין"],
  },
];

const ALIAS_ADDITIONS: Array<{ franchiseeId: string; label: string; add: string[] }> = [
  { franchiseeId: MOTZKIN_ID, label: "קינג קונג מוצקין", add: ["קינג מוצקין"] },
  { franchiseeId: BIG_ID, label: "קינג קונג ביג", add: ["קינג ביג"] },
  {
    franchiseeId: RAANANA_ID,
    label: "קינג קונג רעננה",
    add: ['אטפה בע"מ - קינג קונג קאסטרה רעננה(יש חדש108540)'],
  },
];

async function fixAliases(apply: boolean): Promise<void> {
  console.log("\n=== ALIAS FIXES ===");
  for (const { franchiseeId, label, remove } of ALIAS_REMOVALS) {
    const [row] = await database
      .select({ aliases: franchisee.aliases })
      .from(franchisee)
      .where(eq(franchisee.id, franchiseeId))
      .limit(1);
    const current = row?.aliases ?? [];
    const next = current.filter((a) => !remove.includes(a.trim()));
    const removed = current.length - next.length;
    console.log(`${label}: removing ${removed} alias(es): ${remove.join(" | ")}`);
    if (apply && removed > 0) {
      await database
        .update(franchisee)
        .set({ aliases: next, updatedAt: new Date() })
        .where(eq(franchisee.id, franchiseeId));
    }
  }
  for (const { franchiseeId, label, add } of ALIAS_ADDITIONS) {
    const [row] = await database
      .select({ aliases: franchisee.aliases })
      .from(franchisee)
      .where(eq(franchisee.id, franchiseeId))
      .limit(1);
    const current = row?.aliases ?? [];
    const missing = add.filter((a) => !current.includes(a));
    console.log(`${label}: adding ${missing.length} alias(es): ${missing.join(" | ") || "(already present)"}`);
    if (apply && missing.length > 0) {
      await database
        .update(franchisee)
        .set({ aliases: [...current, ...missing], updatedAt: new Date() })
        .where(eq(franchisee.id, franchiseeId));
    }
  }
}

async function printMatches(fileId: string, label: string): Promise<void> {
  const [file] = await database
    .select({ pr: supplierFileUpload.processingResult })
    .from(supplierFileUpload)
    .where(eq(supplierFileUpload.id, fileId))
    .limit(1);
  const pr = file?.pr as SupplierFileProcessingResult | null;
  console.log(`\n--- matches: ${label} ---`);
  for (const m of pr?.franchiseeMatches ?? []) {
    console.log(
      `  ${m.originalName}  =>  ${m.matchedFranchiseeName ?? "UNMATCHED"}  [${m.matchType}]  net=${m.netAmount}  comm=${m.preCalculatedCommission ?? "-"}`
    );
  }
}

async function printCommissions(supplierId: string, label: string): Promise<void> {
  const rows = await database
    .select({
      franchiseeId: commission.franchiseeId,
      netAmount: commission.netAmount,
      commissionAmount: commission.commissionAmount,
      sourceFileId: commission.sourceFileId,
    })
    .from(commission)
    .where(
      and(
        eq(commission.supplierId, supplierId),
        eq(commission.periodStartDate, "2026-04-01"),
        eq(commission.periodEndDate, "2026-06-30")
      )
    );
  const franchisees = await database
    .select({ id: franchisee.id, name: franchisee.name })
    .from(franchisee);
  const nameById = new Map(franchisees.map((f) => [f.id, f.name]));
  const sum = rows.reduce((acc, r) => acc + parseFloat(r.commissionAmount), 0);
  console.log(`\n--- commissions ${label}: ${rows.length} rows, sum=₪${sum.toFixed(2)} ---`);
  for (const r of rows) {
    console.log(
      `  ${(nameById.get(r.franchiseeId) ?? r.franchiseeId).padEnd(30)} net=${r.netAmount}  amt=${r.commissionAmount}  src=${r.sourceFileId ? "file" : "NULL"}`
    );
  }
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const [mizrachFile] = await database
    .select({ supplierId: supplierFileUpload.supplierId })
    .from(supplierFileUpload)
    .where(eq(supplierFileUpload.id, MIZRACH_FILE_ID))
    .limit(1);
  const [soberFile] = await database
    .select({ supplierId: supplierFileUpload.supplierId })
    .from(supplierFileUpload)
    .where(eq(supplierFileUpload.id, SOBER_FILE_ID))
    .limit(1);
  if (!mizrachFile || !soberFile) throw new Error("file rows not found");

  await printMatches(MIZRACH_FILE_ID, "מזרח ומערב Q2 (BEFORE)");
  await printMatches(SOBER_FILE_ID, "סובר לרנר Q2 (BEFORE)");
  await printCommissions(mizrachFile.supplierId, "מזרח ומערב (BEFORE)");
  await printCommissions(soberFile.supplierId, "סובר לרנר (BEFORE)");

  await fixAliases(apply);

  if (!apply) {
    console.log("\n(dry run — re-run with --apply to fix aliases, reprocess and sync)");
    process.exit(0);
  }

  for (const [fileId, label] of [
    [MIZRACH_FILE_ID, "מזרח ומערב"],
    [SOBER_FILE_ID, "סובר לרנר"],
  ] as const) {
    console.log(`\nReprocessing ${label} (${fileId})...`);
    const rep = await reprocessSupplierFileById(fileId);
    if (!rep.success) throw new Error(`reprocess failed for ${label}: ${rep.error}`);
    console.log(`  net ${rep.before.net} -> ${rep.after.net}`);

    const sync = await syncCommissionsFromUpload(fileId, REVIEWER_USER_ID);
    console.log(`  sync:`, sync);
  }

  await printMatches(MIZRACH_FILE_ID, "מזרח ומערב Q2 (AFTER)");
  await printMatches(SOBER_FILE_ID, "סובר לרנר Q2 (AFTER)");
  await printCommissions(mizrachFile.supplierId, "מזרח ומערב (AFTER)");
  await printCommissions(soberFile.supplierId, "סובר לרנר (AFTER)");
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
