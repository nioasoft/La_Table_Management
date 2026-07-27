/**
 * Heal BKMV files that carry an opening-balance batch (יתרות פתיחה).
 *
 * Some bookkeepers post a whole journal on 1 January as document #1 with no
 * description — balance-sheet accounts plus every supplier's balance carried
 * over from last year, credit side with a minus sign. Until
 * `isOpeningBalanceEntry` was added to the parser those rows were counted as
 * January transactions, which flipped January's supplier totals negative and
 * doubled the gap in the reconciliation report.
 *
 * This script re-parses ONLY the files that contain such a batch and rewrites
 * their stored breakdown through the same path the bulk reprocess endpoint
 * uses. Files without the batch are left untouched, so no unrelated parser
 * drift gets written to production.
 *
 * Existing supplier matches are preserved (no rematch). `upsertFromFullBreakdown`
 * merges per month and flags overlapping reconciliation sessions stale by itself.
 *
 *   npx tsx src/scripts/heal-bkmv-opening-balance.ts            # dry run
 *   npx tsx src/scripts/heal-bkmv-opening-balance.ts --apply    # write
 */
import { database } from "@/db";
import { uploadedFile } from "@/db/schema";
import type { BkmvProcessingResult } from "@/db/schema";
import { isNotNull, eq, sql, asc } from "drizzle-orm";
import { getDocument } from "@/lib/storage";
import { parseBkmvData, buildMonthlyBreakdown } from "@/lib/bkmvdata-parser";
import { upsertFromFullBreakdown } from "@/data-access/franchisee-bkmv-year";
import type { MonthlyBreakdown } from "@/lib/bkmvdata/types";

const APPLY = process.argv.includes("--apply");

/** Total per month, and how many entries are negative — the symptom we fix. */
function monthStats(breakdown: MonthlyBreakdown | undefined, month: string) {
  const entries = breakdown?.[month] ?? [];
  return {
    count: entries.length,
    negative: entries.filter((e) => e.amount < 0).length,
    total: Math.round(entries.reduce((sum, e) => sum + e.amount, 0)),
  };
}

async function main() {
  const files = await database
    .select({
      id: uploadedFile.id,
      fileUrl: uploadedFile.fileUrl,
      franchiseeId: uploadedFile.franchiseeId,
      bkmvProcessingResult: uploadedFile.bkmvProcessingResult,
      originalFileName: uploadedFile.originalFileName,
      createdAt: uploadedFile.createdAt,
    })
    .from(uploadedFile)
    .where(isNotNull(uploadedFile.bkmvProcessingResult))
    // Oldest first: a franchisee's year is merged month-by-month, so the newest
    // file must be written last for overlapping months.
    .orderBy(asc(uploadedFile.createdAt));

  console.log(`${files.length} BKMV files with a stored result\n`);

  let affected = 0;
  let healed = 0;
  const failures: Array<{ file: string; error: string }> = [];

  for (const file of files) {
    if (!file.fileUrl) continue;

    let parseResult;
    try {
      const buffer = await getDocument(file.fileUrl);
      if (!buffer) continue;
      parseResult = parseBkmvData(buffer);
    } catch (err) {
      failures.push({
        file: file.originalFileName,
        error: err instanceof Error ? err.message : "download/parse failed",
      });
      continue;
    }

    const skipWarning = parseResult.warnings.find((w) => w.includes("יתרות פתיחה"));
    if (!skipWarning) continue; // no opening-balance batch — leave it alone

    affected++;
    const existing = file.bkmvProcessingResult as BkmvProcessingResult;

    // Reuse the matches already confirmed for this file — never rematch here.
    const supplierIdMap = new Map<string, string | null>();
    for (const m of existing.supplierMatches ?? []) {
      supplierIdMap.set(m.bkmvName, m.matchedSupplierId);
    }

    const rebuilt = buildMonthlyBreakdown(parseResult.transactions, supplierIdMap);
    const before = existing.monthlyBreakdown as MonthlyBreakdown | undefined;

    const januaries = [
      ...new Set([...Object.keys(before ?? {}), ...Object.keys(rebuilt)]),
    ]
      .filter((m) => m.endsWith("-01"))
      .sort();

    console.log(`${file.originalFileName}`);
    console.log(`  ${skipWarning}`);
    for (const month of januaries) {
      const b = monthStats(before, month);
      const a = monthStats(rebuilt, month);
      console.log(
        `  ${month}: entries ${b.count}→${a.count} | negative ${b.negative}→${a.negative} | total ₪${b.total.toLocaleString("he-IL")}→₪${a.total.toLocaleString("he-IL")}`
      );
    }

    if (!APPLY) {
      console.log("  (dry run — nothing written)\n");
      continue;
    }

    try {
      await database
        .update(uploadedFile)
        .set({
          bkmvProcessingResult: sql`${JSON.stringify({ ...existing, monthlyBreakdown: rebuilt })}::jsonb`,
        })
        .where(eq(uploadedFile.id, file.id));

      if (file.franchiseeId) {
        const result = await upsertFromFullBreakdown(
          file.franchiseeId,
          rebuilt,
          existing.supplierMatches ?? null,
          file.id
        );
        console.log(
          `  written — years updated: ${result.updated.join(", ") || "none"}`
        );
      } else {
        console.log("  written — file has no franchisee, year table untouched");
      }
      healed++;
    } catch (err) {
      failures.push({
        file: file.originalFileName,
        error: err instanceof Error ? err.message : "write failed",
      });
    }
    console.log("");
  }

  console.log(
    `\n${affected} files carry an opening-balance batch; ${APPLY ? `${healed} healed` : "dry run — run again with --apply to write"}`
  );
  if (failures.length) {
    console.log("\nFAILURES:");
    for (const f of failures) console.log(`  ${f.file}: ${f.error}`);
  }
  process.exit(failures.length ? 1 : 0);
}

main();
