/**
 * Cross-cutting audit of the מבנה אחיד path: does every BKMV file that arrived
 * actually reach every consumer that should see it?
 *
 * Checks, in order of how badly each one bites:
 *   A. uploaded_file rows that should carry a franchisee_id but don't
 *   B. BKMV rows with a franchisee but no period columns (invisible to every
 *      period-filtered query even though franchisee_id is set)
 *   C. franchisees with an approved BKMV file but no franchisee_bkmv_year row
 *      (reconciliation V2's primary source — the uploaded_file read is only a
 *      fallback for franchisees missing from that table)
 *   D. open file requests measured against what the franchisee's files honestly
 *      cover, so a stale reminder can be told apart from a real one
 *
 * Read-only. Run: npx tsx src/scripts/audit-bkmv-visibility.ts
 */
import "dotenv/config";
import { database, pool } from "../db";
import {
  franchisee,
  uploadLink,
  uploadedFile,
  franchiseeBkmvYear,
  fileRequest,
} from "../db/schema";
import { and, eq, isNull, isNotNull, ne } from "drizzle-orm";
import { bkmvCoverageEnd } from "../lib/bkmv-coverage";

async function main() {
  const franchisees = await database.select().from(franchisee);
  const nameById = new Map(franchisees.map((f) => [f.id, f.name]));

  // ── A. missing franchisee_id ──────────────────────────────────────────────
  const orphans = await database
    .select({
      id: uploadedFile.id,
      name: uploadedFile.originalFileName,
      createdAt: uploadedFile.createdAt,
      status: uploadedFile.processingStatus,
      hasBkmv: uploadedFile.bkmvProcessingResult,
      entityType: uploadLink.entityType,
      entityId: uploadLink.entityId,
    })
    .from(uploadedFile)
    .leftJoin(uploadLink, eq(uploadedFile.uploadLinkId, uploadLink.id))
    .where(isNull(uploadedFile.franchiseeId));

  const shouldHaveFranchisee = orphans.filter(
    (o) => o.entityType === "franchisee" || o.hasBkmv !== null
  );
  console.log(`\n=== A. uploaded_file with NULL franchisee_id ===`);
  console.log(`   total ${orphans.length}, of which BKMV/franchisee-linked: ${shouldHaveFranchisee.length}`);
  for (const o of shouldHaveFranchisee) {
    console.log(
      `   !! ${o.createdAt.toISOString().slice(0, 16)} | ${o.name} | ${o.status} | entity=${o.entityType ?? "(no link)"} ${nameById.get(o.entityId ?? "") ?? o.entityId ?? ""}`
    );
  }
  const supplierOrphans = orphans.length - shouldHaveFranchisee.length;
  console.log(`   (${supplierOrphans} supplier-link rows — correctly have no franchisee)`);

  // ── B. BKMV rows with no period ───────────────────────────────────────────
  const noPeriod = await database
    .select({
      id: uploadedFile.id,
      name: uploadedFile.originalFileName,
      createdAt: uploadedFile.createdAt,
      status: uploadedFile.processingStatus,
      franchiseeId: uploadedFile.franchiseeId,
      bkmv: uploadedFile.bkmvProcessingResult,
    })
    .from(uploadedFile)
    .where(
      and(
        isNotNull(uploadedFile.bkmvProcessingResult),
        isNull(uploadedFile.periodStartDate),
        ne(uploadedFile.processingStatus, "rejected")
      )
    );

  console.log(`\n=== B. BKMV files with no period columns: ${noPeriod.length} ===`);
  for (const f of noPeriod) {
    const range = (f.bkmv as { dateRange?: { startDate?: string; endDate?: string } } | null)
      ?.dateRange;
    console.log(
      `   !! ${f.createdAt.toISOString().slice(0, 16)} | ${nameById.get(f.franchiseeId ?? "") ?? "(no franchisee)"} | ${f.name} | ${f.status} | JSON range: ${range?.startDate ?? "?"}..${range?.endDate ?? "?"}`
    );
  }

  // ── C. approved BKMV file but no year row ─────────────────────────────────
  const approvedBkmv = await database
    .select({
      franchiseeId: uploadedFile.franchiseeId,
      createdAt: uploadedFile.createdAt,
      periodStartDate: uploadedFile.periodStartDate,
      periodEndDate: uploadedFile.periodEndDate,
    })
    .from(uploadedFile)
    .where(
      and(
        isNotNull(uploadedFile.bkmvProcessingResult),
        isNotNull(uploadedFile.franchiseeId),
        ne(uploadedFile.processingStatus, "rejected")
      )
    );

  const years = await database.select().from(franchiseeBkmvYear);

  // Flag only franchisees with NO year row at all. Anything finer guesses which
  // years a snapshot covers: period_start_date is the earliest transaction date,
  // so a 2026 file routinely starts 2024-12-12 without owing a 2024 year row.
  const withFiles = new Set(approvedBkmv.map((f) => f.franchiseeId).filter(Boolean) as string[]);
  const withYearRows = new Set(years.map((y) => y.franchiseeId));
  const missingYearRows = [...withFiles].filter((id) => !withYearRows.has(id));

  console.log(
    `\n=== C. approved BKMV file but no franchisee_bkmv_year row at all: ${missingYearRows.length} ===`
  );
  for (const fid of missingYearRows) {
    console.log(`   !! ${nameById.get(fid) ?? fid}`);
  }

  // ── D. requests still open for franchisees who delivered ──────────────────
  const openRequests = await database
    .select({
      id: fileRequest.id,
      entityId: fileRequest.entityId,
      entityType: fileRequest.entityType,
      status: fileRequest.status,
      createdAt: fileRequest.createdAt,
      documentType: fileRequest.documentType,
      dueDate: fileRequest.dueDate,
    })
    .from(fileRequest)
    .where(
      and(eq(fileRequest.entityType, "franchisee"), ne(fileRequest.status, "submitted"))
    );

  // "Has a file" is not the question — "has a file that reaches the request" is.
  // Report each franchisee's honest coverage end (bkmvCoverageEnd, not
  // period_end_date, which is just the max transaction date) and let the reader
  // compare it to when the request was opened.
  const coverage = new Map<string, string>();
  for (const f of approvedBkmv) {
    if (!f.franchiseeId) continue;
    const end = bkmvCoverageEnd(f.periodEndDate, f.createdAt);
    if (!end) continue;
    const prev = coverage.get(f.franchiseeId);
    if (!prev || end > prev) coverage.set(f.franchiseeId, end);
  }

  console.log(`\n=== D. open franchisee file requests: ${openRequests.length} ===`);
  for (const r of openRequests) {
    const opened = r.createdAt.toISOString().slice(0, 10);
    const end = coverage.get(r.entityId);
    const stale = !end || end < opened;
    console.log(
      `   ${stale ? "still owed " : "?? covered "} | ${nameById.get(r.entityId) ?? r.entityId} | ${r.documentType} | ${r.status} | opened ${opened} | BKMV covers through ${end ?? "(nothing)"}`
    );
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
