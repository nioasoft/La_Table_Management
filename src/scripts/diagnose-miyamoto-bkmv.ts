/**
 * Read-only diagnostic: מיאמוטו says they uploaded a מבנה אחיד file through
 * their secure link ~2 weeks ago, but the חסרים board still shows them missing.
 *
 * Walks the whole path a public-link BKMV upload takes, so we can tell which
 * step actually dropped it:
 *   franchisee → upload_link → uploaded_file → bkmv_processing_result →
 *   franchisee_bkmv_year
 *
 * Run: npx tsx src/scripts/diagnose-miyamoto-bkmv.ts
 */
import "dotenv/config";
import { database, pool } from "../db";
import { franchisee, uploadLink, uploadedFile, franchiseeBkmvYear } from "../db/schema";
import { ilike, or, eq, inArray, desc, gte } from "drizzle-orm";

const NAME_PATTERNS = ["%מיאמוטו%", "%miyamoto%", "%מייאמוטו%"];

async function main() {
  // 1. Which franchisees answer to that name (including aliases)?
  const franchisees = await database
    .select()
    .from(franchisee)
    .where(or(...NAME_PATTERNS.map((p) => ilike(franchisee.name, p))));

  console.log(`\n=== FRANCHISEES matching מיאמוטו: ${franchisees.length} ===`);
  for (const f of franchisees) {
    console.log(
      `  ${f.name} | id=${f.id} | code=${f.code} | active=${f.isActive} | companyId=${f.companyId} | brandId=${f.brandId}`
    );
    console.log(`    aliases: ${JSON.stringify(f.aliases)}`);
  }

  // Also scan aliases across ALL franchisees — the name may live only there
  const all = await database.select().from(franchisee);
  const viaAlias = all.filter((f) =>
    JSON.stringify(f.aliases ?? []).includes("מיאמוטו")
  );
  console.log(`\n=== FRANCHISEES with מיאמוטו in aliases: ${viaAlias.length} ===`);
  for (const f of viaAlias) console.log(`  ${f.name} | id=${f.id}`);

  const ids = [...new Set([...franchisees, ...viaAlias].map((f) => f.id))];
  if (ids.length === 0) {
    console.log("\n!! No franchisee matches — the name may belong to a supplier instead.");
    await pool.end();
    return;
  }

  // 2. Upload links pointing at them
  const links = await database
    .select()
    .from(uploadLink)
    .where(inArray(uploadLink.entityId, ids));

  console.log(`\n=== UPLOAD LINKS: ${links.length} ===`);
  for (const l of links) {
    console.log(
      `  ${l.name} | id=${l.id} | status=${l.status} | entityType=${l.entityType} | expires=${l.expiresAt?.toISOString() ?? "-"} | usedAt=${l.usedAt?.toISOString() ?? "never"} | usedBy=${l.usedByEmail ?? "-"}`
    );
  }

  // 3. Files that arrived — by link AND by direct franchisee reference
  const linkIds = links.map((l) => l.id);
  const files = await database
    .select()
    .from(uploadedFile)
    .where(
      or(
        linkIds.length ? inArray(uploadedFile.uploadLinkId, linkIds) : undefined,
        inArray(uploadedFile.franchiseeId, ids)
      )
    )
    .orderBy(desc(uploadedFile.createdAt));

  console.log(`\n=== UPLOADED FILES: ${files.length} ===`);
  for (const f of files) {
    const r = f.bkmvProcessingResult as Record<string, unknown> | null;
    console.log(
      `  ${f.createdAt.toISOString().slice(0, 16)} | ${f.originalFileName} | ${f.fileSize}B | status=${f.processingStatus} | period=${f.periodStartDate}..${f.periodEndDate} | franchiseeId=${f.franchiseeId ?? "(via link)"} | by=${f.uploadedByEmail ?? "-"}`
    );
    if (r) {
      console.log(
        `      bkmv: months=${JSON.stringify((r.monthlyBreakdown as unknown[])?.length ?? 0)} suppliers=${((r.supplierMatches as unknown[]) ?? []).length} notes=${r.error ?? r.warning ?? ""}`
      );
    } else {
      console.log("      bkmv: NO PROCESSING RESULT");
    }
    if (f.reviewNotes) console.log(`      reviewNotes: ${f.reviewNotes}`);
  }

  // 4. Anything at all uploaded in the last 30 days, so we can spot a file that
  //    landed under the WRONG franchisee (the usual cause of "I did upload it")
  const since = new Date();
  since.setDate(since.getDate() - 30);
  const recent = await database
    .select({
      id: uploadedFile.id,
      name: uploadedFile.originalFileName,
      createdAt: uploadedFile.createdAt,
      status: uploadedFile.processingStatus,
      franchiseeId: uploadedFile.franchiseeId,
      linkId: uploadedFile.uploadLinkId,
      email: uploadedFile.uploadedByEmail,
      periodStart: uploadedFile.periodStartDate,
      periodEnd: uploadedFile.periodEndDate,
    })
    .from(uploadedFile)
    .where(gte(uploadedFile.createdAt, since))
    .orderBy(desc(uploadedFile.createdAt));

  const nameById = new Map(all.map((f) => [f.id, f.name]));
  const linkById = new Map(links.map((l) => [l.id, l.name]));
  console.log(`\n=== ALL UPLOADS IN THE LAST 30 DAYS: ${recent.length} ===`);
  for (const f of recent) {
    const owner =
      (f.franchiseeId && nameById.get(f.franchiseeId)) ||
      (f.linkId && linkById.get(f.linkId)) ||
      `link:${f.linkId ?? "-"}`;
    console.log(
      `  ${f.createdAt.toISOString().slice(0, 16)} | ${owner} | ${f.name} | ${f.status} | ${f.periodStart}..${f.periodEnd} | ${f.email ?? "-"}`
    );
  }

  // 5. What the חסרים board reads from
  const years = await database
    .select()
    .from(franchiseeBkmvYear)
    .where(inArray(franchiseeBkmvYear.franchiseeId, ids));

  console.log(`\n=== FRANCHISEE_BKMV_YEAR: ${years.length} ===`);
  for (const y of years) {
    console.log(
      `  ${nameById.get(y.franchiseeId)} | year=${y.year} | months=${y.monthCount} ${JSON.stringify(y.monthsCovered)} | complete=${y.isComplete} | latestFile=${y.latestSourceFileId} | updated=${y.updatedAt.toISOString().slice(0, 16)}`
    );
  }

  await pool.end();
}

main().catch(async (e) => {
  console.error(e);
  await pool.end();
  process.exit(1);
});
