/**
 * Read-only audit: re-run the franchisee name matcher against today's aliases
 * over every stored supplier file, and report rows whose stored match differs.
 *
 * Match results are frozen into supplier_file_upload.processingResult at upload
 * time and are never re-validated. So an alias fix (or a new franchisee) leaves
 * every earlier file pointing at the old franchisee — silently, with money on
 * the wrong branch. That is how קינג קונג מוצקין stayed glued to כרמיאל in five
 * Q2-2026 files for weeks after the 2026-07-23 alias cleanup.
 *
 * Run this after ANY alias edit or franchisee rename. Anything it prints needs
 * `reprocessSupplierFileById` + `syncCommissionsFromUpload` (see
 * fix-motzkin-misroute-q2-2026.ts for the shape).
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/audit-match-drift.ts [YYYY-MM-DD]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import {
  franchisee,
  supplier,
  supplierFileUpload,
  type SupplierFileProcessingResult,
} from "@/db/schema";
import { eq, and, ne, gte } from "drizzle-orm";
import { matchFranchiseeNamesFromFile } from "@/data-access/franchisees";

/**
 * Suppliers whose rows are matched on the ח.פ. from the file, not the name.
 * Their name column is an address ("חדרה", "ביג כרמיאל") that resolves to a
 * different branch by name alone, so every row would read as false drift.
 */
const BUSINESS_ID_MATCHED_SUPPLIERS = new Set(["DAGEI_HAKIBBUTZIM"]);

async function main(): Promise<void> {
  const since = process.argv[2] ?? "2026-01-01";

  const files = await database
    .select({
      id: supplierFileUpload.id,
      fileName: supplierFileUpload.originalFileName,
      periodStart: supplierFileUpload.periodStartDate,
      periodEnd: supplierFileUpload.periodEndDate,
      status: supplierFileUpload.processingStatus,
      pr: supplierFileUpload.processingResult,
      supplierName: supplier.name,
      supplierCode: supplier.code,
    })
    .from(supplierFileUpload)
    .innerJoin(supplier, eq(supplier.id, supplierFileUpload.supplierId))
    .where(
      and(
        ne(supplierFileUpload.processingStatus, "rejected"),
        gte(supplierFileUpload.periodStartDate, since)
      )
    );

  const franchisees = await database
    .select({ id: franchisee.id, name: franchisee.name })
    .from(franchisee);
  const nameById = new Map(franchisees.map((f) => [f.id, f.name]));

  console.log(`auditing ${files.length} files from ${since}...\n`);
  let drifting = 0;

  for (const f of files) {
    if (f.supplierCode && BUSINESS_ID_MATCHED_SUPPLIERS.has(f.supplierCode)) continue;

    const matches = (f.pr as SupplierFileProcessingResult | null)?.franchiseeMatches ?? [];
    if (matches.length === 0) continue;

    const fresh = await matchFranchiseeNamesFromFile(
      matches.map((m) => ({ franchisee: m.originalName }))
    );

    const lines: string[] = [];
    matches.forEach((m, i) => {
      // Manual overrides are deliberate. exact_code rows matched on the ח.פ.
      // from the file (e.g. דגי הקיבוצים) — a name-only re-match can't
      // reproduce those, so they would all read as false drift.
      if (m.matchType === "manual" || m.matchType === "exact_code") return;

      const now = fresh[i]?.matchResult.matchedFranchisee?.id ?? null;
      // Only a confident DIFFERENT match is drift; "no longer matches by name"
      // is usually just a supplier whose real match path is the business id.
      if (!now || now === m.matchedFranchiseeId) return;

      lines.push(
        `   "${m.originalName}" net=${m.netAmount}\n` +
          `        stored: ${m.matchedFranchiseeName ?? "UNMATCHED"} [${m.matchType}]\n` +
          `        today : ${nameById.get(now)} [${fresh[i].matchResult.matchType}]`
      );
    });

    if (lines.length > 0) {
      drifting += lines.length;
      console.log(
        `=== ${f.supplierName} | ${f.fileName} | ${f.periodStart}..${f.periodEnd} | ${f.status} | ${f.id}`
      );
      console.log(`${lines.join("\n")}\n`);
    }
  }

  console.log(`${drifting} drifting row(s)`);
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
