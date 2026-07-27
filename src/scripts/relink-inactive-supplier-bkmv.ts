/**
 * One-off: re-link BKMV rows that lost their supplier because the supplier was
 * deactivated.
 *
 * matchBkmvSuppliers used to match against active suppliers only, so the first
 * מבנה אחיד upload after a supplier was deactivated rewrote that franchisee's
 * monthly breakdown with matchedSupplierId = null — for EVERY month in the
 * cumulative file, including already-reconciled ones. גרינטי (deactivated
 * 2026-05-14) and היכל היין (2026-07-22) dropped to ₪0 in the Q1 2026 sessions.
 * The matcher now includes inactive suppliers; this replays the affected files
 * so the stored data catches up.
 *
 * Reprocesses the LATEST BKMV file per affected (franchisee, year) — those
 * files are cumulative from January, so one replay per year restores every
 * month. Manual matches are preserved (reprocessBkmvFileById).
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/relink-inactive-supplier-bkmv.ts          # dry run
 *   dotenv -e .env -- npx tsx src/scripts/relink-inactive-supplier-bkmv.ts --apply
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { franchiseeBkmvYear, franchisee, supplier, uploadedFile } from "@/db/schema";
import { and, desc, eq, isNotNull, lte, gte } from "drizzle-orm";
import { normalizeName } from "@/lib/supplier-matcher";
import { reprocessBkmvFileById } from "@/data-access/bkmv-reprocess";

const APPLY = process.argv.includes("--apply");

async function main() {
  // Names the matcher can no longer see: inactive, still-visible suppliers.
  const inactive = await database
    .select({
      id: supplier.id,
      name: supplier.name,
      bkmvAliases: supplier.bkmvAliases,
    })
    .from(supplier)
    .where(and(eq(supplier.isActive, false), eq(supplier.isHidden, false)));

  const nameToSupplier = new Map<string, string>();
  for (const s of inactive) {
    for (const n of [s.name, ...((s.bkmvAliases as string[] | null) ?? [])]) {
      nameToSupplier.set(normalizeName(n), s.name);
    }
  }
  console.log(
    `${inactive.length} inactive suppliers: ${inactive.map((s) => s.name).join(", ")}\n`
  );

  const years = await database
    .select({
      franchiseeId: franchiseeBkmvYear.franchiseeId,
      franchiseeName: franchisee.name,
      year: franchiseeBkmvYear.year,
      supplierMatches: franchiseeBkmvYear.supplierMatches,
    })
    .from(franchiseeBkmvYear)
    .innerJoin(franchisee, eq(franchisee.id, franchiseeBkmvYear.franchiseeId));

  type Affected = {
    franchiseeId: string;
    franchiseeName: string;
    year: number;
    lostNames: string[];
  };
  const affected: Affected[] = [];

  for (const row of years) {
    const matches =
      (row.supplierMatches as Array<{
        bkmvName: string;
        matchedSupplierId: string | null;
      }> | null) ?? [];
    const lostNames = matches
      .filter((m) => !m.matchedSupplierId && nameToSupplier.has(normalizeName(m.bkmvName)))
      .map((m) => m.bkmvName);
    if (lostNames.length > 0) {
      affected.push({
        franchiseeId: row.franchiseeId,
        franchiseeName: row.franchiseeName,
        year: row.year,
        lostNames,
      });
    }
  }

  console.log(
    `${affected.length} affected franchisee-years${APPLY ? "" : " (dry run — nothing will be written)"}\n`
  );

  for (const a of affected) {
    // Latest BKMV file whose period overlaps that year — cumulative, so it
    // carries every month of it.
    const [file] = await database
      .select({
        id: uploadedFile.id,
        originalFileName: uploadedFile.originalFileName,
        periodStartDate: uploadedFile.periodStartDate,
        periodEndDate: uploadedFile.periodEndDate,
      })
      .from(uploadedFile)
      .where(
        and(
          eq(uploadedFile.franchiseeId, a.franchiseeId),
          isNotNull(uploadedFile.bkmvProcessingResult),
          lte(uploadedFile.periodStartDate, `${a.year}-12-31`),
          gte(uploadedFile.periodEndDate, `${a.year}-01-01`)
        )
      )
      .orderBy(desc(uploadedFile.createdAt))
      .limit(1);

    const label = `${a.franchiseeName} ${a.year} — lost: ${a.lostNames.join(", ")}`;

    if (!file) {
      console.log(`✗  ${label} — no BKMV file found, skipping`);
      continue;
    }

    if (!APPLY) {
      console.log(
        `→  ${label}\n     would reprocess ${file.originalFileName} (${file.periodStartDate}..${file.periodEndDate})`
      );
      continue;
    }

    const result = await reprocessBkmvFileById(file.id);
    console.log(
      result.success
        ? `✓  ${label}\n     reprocessed ${file.originalFileName} (manual matches kept: ${result.manualMatchesPreserved})`
        : `✗  ${label}\n     reprocess FAILED: ${result.error}`
    );
  }

  if (!APPLY) {
    console.log("\nDry run — re-run with --apply to reprocess.");
  }
  process.exit(0);
}

main().catch((err) => {
  console.error("Failed:", err);
  process.exit(1);
});
