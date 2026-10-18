/**
 * DB side of BKMV year-archive ownership. The rule itself — the newest live
 * file owns a month unless its version is a stray sliver — lives in
 * src/lib/bkmvdata/archive-ownership.ts.
 *
 * Imports nothing from franchisee-bkmv-year (which imports this module).
 */
import { database } from "@/db";
import { franchiseeBkmvYear, uploadedFile } from "@/db/schema";
import { and, eq, ne, isNotNull, sql } from "drizzle-orm";
import {
  canonicalArchiveMonths,
  changedMonths,
  groupIntoConsecutiveRuns,
  aggregateSupplierMatchesFromBreakdown,
  type ArchiveFileMonths,
  type ArchiveSourceFile,
  type MonthlyBreakdown,
} from "@/lib/bkmvdata-parser";

/** Live (non-rejected) BKMV files of a franchisee — only what ownership needs. */
export async function getLiveBkmvFiles(franchiseeId: string): Promise<ArchiveSourceFile[]> {
  const rows = await database
    .select({
      id: uploadedFile.id,
      createdAt: uploadedFile.createdAt,
      monthlyBreakdown: sql<MonthlyBreakdown | null>`${uploadedFile.bkmvProcessingResult}->'monthlyBreakdown'`,
      supplierMatches: sql<ArchiveSourceFile["supplierMatches"] | null>`${uploadedFile.bkmvProcessingResult}->'supplierMatches'`,
    })
    .from(uploadedFile)
    .where(
      and(
        eq(uploadedFile.franchiseeId, franchiseeId),
        ne(uploadedFile.processingStatus, "rejected"),
        isNotNull(uploadedFile.bkmvProcessingResult)
      )
    );

  return rows
    .filter((r) => r.monthlyBreakdown)
    .map((r) => ({
      id: r.id,
      createdAt: r.createdAt,
      monthlyBreakdown: r.monthlyBreakdown!,
      supplierMatches: r.supplierMatches ?? [],
    }));
}

/**
 * Lean variant for the write path — month → transaction count per live file,
 * computed in SQL so an upload doesn't pull every file's breakdown. Literal,
 * explicitly qualified SQL: drizzle drops table qualifiers in single-table
 * selects, which breaks correlated subqueries silently.
 */
export async function getLiveBkmvFileMonths(
  franchiseeId: string,
  excludeFileId: string
): Promise<ArchiveFileMonths[]> {
  const rows = await database
    .select({
      id: uploadedFile.id,
      createdAt: uploadedFile.createdAt,
      monthTxns: sql<Record<string, number> | null>`(
        select jsonb_object_agg(m.key, (
          select coalesce(sum((e->>'transactionCount')::int), 0) from jsonb_array_elements(m.value) e
        ))
        from jsonb_each("uploaded_file"."bkmv_processing_result"->'monthlyBreakdown') m
      )`,
    })
    .from(uploadedFile)
    .where(
      and(
        eq(uploadedFile.franchiseeId, franchiseeId),
        ne(uploadedFile.processingStatus, "rejected"),
        ne(uploadedFile.id, excludeFileId),
        sql`jsonb_typeof(${uploadedFile.bkmvProcessingResult}->'monthlyBreakdown') = 'object'`
      )
    );
  return rows.map((r) => ({ id: r.id, createdAt: r.createdAt, monthTxns: r.monthTxns ?? {} }));
}

/**
 * Flag active reconciliation sessions stale for months whose franchisee-side
 * data changed — grouped into consecutive runs so an edit touching Jan and Jul
 * doesn't drag Feb–Jun along. Best-effort; dynamic import avoids a cycle with
 * reconciliation-v2.
 */
export async function flagSessionsStaleForMonths(
  franchiseeId: string,
  changed: string[]
): Promise<void> {
  const months = [...new Set(changed.filter((k) => /^\d{4}-\d{2}$/.test(k)))].sort();
  if (months.length === 0) return;
  try {
    const { markFranchiseeSessionsStale } = await import("@/data-access/reconciliation-v2");
    for (const [first, last] of groupIntoConsecutiveRuns(months)) {
      const [ey, em] = last.split("-").map(Number);
      // new Date(year, month, 0).getDate() → last day of that 1-indexed month
      const periodEnd = `${last}-${String(new Date(ey, em, 0).getDate()).padStart(2, "0")}`;
      await markFranchiseeSessionsStale(franchiseeId, `${first}-01`, periodEnd);
    }
  } catch (staleErr) {
    console.error("Failed to flag reconciliation sessions stale after BKMV archive change:", staleErr);
  }
}

/** Replace a year record's breakdown; an empty breakdown deletes the record. */
async function writeYearRecord(
  franchiseeId: string,
  year: number,
  recordId: string | undefined,
  breakdown: MonthlyBreakdown
): Promise<void> {
  const monthsCovered = Object.keys(breakdown)
    .map((m) => Number(m.slice(5, 7)))
    .sort((a, b) => a - b);
  if (monthsCovered.length === 0) {
    if (recordId) await database.delete(franchiseeBkmvYear).where(eq(franchiseeBkmvYear.id, recordId));
    return;
  }

  const values = {
    monthlyBreakdown: sql`${JSON.stringify(breakdown)}::jsonb`,
    supplierMatches: sql`${JSON.stringify(aggregateSupplierMatchesFromBreakdown(breakdown))}::jsonb`,
    monthCount: monthsCovered.length,
    monthsCovered: sql`${JSON.stringify(monthsCovered)}::jsonb`,
    isComplete: monthsCovered.length === 12,
    updatedAt: new Date(),
  };
  if (recordId) {
    await database.update(franchiseeBkmvYear).set(values).where(eq(franchiseeBkmvYear.id, recordId));
  } else {
    await database
      .insert(franchiseeBkmvYear)
      .values({ id: crypto.randomUUID(), franchiseeId, year, createdAt: new Date(), ...values });
  }
}

/**
 * Rewrite `months` of the franchisee's year archive to what their owners hold
 * (canonicalArchiveMonths): a month comes from its owner, a month no live file
 * owns leaves, a year left empty is deleted. Flags sessions stale for the
 * months that actually changed and returns them. dryRun computes only.
 */
export async function rebuildBkmvArchiveMonths(
  franchiseeId: string,
  months: string[],
  opts?: { dryRun?: boolean }
): Promise<string[]> {
  const canonical = canonicalArchiveMonths(await getLiveBkmvFiles(franchiseeId), months);

  const monthsByYear = new Map<number, string[]>();
  for (const month of Object.keys(canonical).filter((m) => /^\d{4}-\d{2}$/.test(m))) {
    const year = Number(month.slice(0, 4));
    monthsByYear.set(year, [...(monthsByYear.get(year) ?? []), month]);
  }

  const changed: string[] = [];
  for (const [year, yearMonths] of monthsByYear) {
    const [record] = await database
      .select()
      .from(franchiseeBkmvYear)
      .where(and(eq(franchiseeBkmvYear.franchiseeId, franchiseeId), eq(franchiseeBkmvYear.year, year)))
      .limit(1);
    const before = (record?.monthlyBreakdown as MonthlyBreakdown | undefined) ?? {};
    const after: MonthlyBreakdown = { ...before };
    for (const month of yearMonths) {
      const entries = canonical[month];
      if (entries) after[month] = entries;
      else delete after[month];
    }

    const removed = yearMonths.filter((m) => m in before && !(m in after));
    const yearChanged = [...changedMonths(before, after), ...removed];
    if (yearChanged.length === 0) continue;
    changed.push(...yearChanged);
    if (!opts?.dryRun) await writeYearRecord(franchiseeId, year, record?.id, after);
  }

  if (!opts?.dryRun) await flagSessionsStaleForMonths(franchiseeId, changed);
  return changed.sort();
}

/**
 * A BKMV file moving into or out of "rejected" changes who owns its months:
 * upload-time archiving already wrote them, so a rejected file must hand them
 * back, and an un-rejected one takes back what it owns. Best-effort — the
 * status change itself already happened. Returns the archive months changed.
 */
export async function syncBkmvArchiveForStatusChange(
  fileId: string,
  previousStatus: string | null,
  newStatus: string
): Promise<string[]> {
  if ((previousStatus === "rejected") === (newStatus === "rejected")) return [];
  try {
    const [file] = await database
      .select({
        franchiseeId: uploadedFile.franchiseeId,
        monthlyBreakdown: sql<MonthlyBreakdown | null>`${uploadedFile.bkmvProcessingResult}->'monthlyBreakdown'`,
      })
      .from(uploadedFile)
      .where(eq(uploadedFile.id, fileId))
      .limit(1);
    if (!file?.franchiseeId || !file.monthlyBreakdown) return [];
    return await rebuildBkmvArchiveMonths(file.franchiseeId, Object.keys(file.monthlyBreakdown));
  } catch (err) {
    console.error("Failed to rebuild BKMV archive after status change:", err);
    return [];
  }
}
