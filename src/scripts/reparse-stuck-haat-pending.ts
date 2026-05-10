/**
 * One-off CLI: re-parse the 3 HAAT income invoices stuck at
 * processing_status='pending' because the original parse missed the
 * period (warning "לא זוהתה תקופת החשבונית").
 *
 * The parser layout fix (invoice-mishloha-parser.ts, display-order RTL
 * "DD/MM/YYYY :תאריך" pattern) lets us re-extract the period now.
 *
 * For each stuck row:
 *   - download the PDF from its existing blob URL
 *   - run parseMishlohaFile (the parser HAAT routes through for invoices)
 *   - validate the parsed period matches the row's stored period_month
 *   - UPDATE processing_result + processing_status='auto_approved'
 *
 * Usage:
 *   dotenv -e .env -- npx tsx src/scripts/reparse-stuck-haat-pending.ts [--apply]
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { clientDocument } from "@/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { parseMishlohaFile } from "@/lib/client-parsers/invoice-mishloha-parser";

async function downloadBuffer(url: string): Promise<Buffer> {
  const res = await fetch(url);
  if (!res.ok) throw new Error(`HTTP ${res.status} fetching ${url}`);
  return Buffer.from(await res.arrayBuffer());
}

async function main() {
  const apply = process.argv.includes("--apply");

  const stuck = await database
    .select({
      id: clientDocument.id,
      franchiseeId: clientDocument.franchiseeId,
      fileUrl: clientDocument.fileUrl,
      periodMonth: clientDocument.periodMonth,
      periodYear: clientDocument.periodYear,
      originalFileName: clientDocument.originalFileName,
    })
    .from(clientDocument)
    .where(
      and(
        eq(clientDocument.processingStatus, "pending"),
        sql`${clientDocument.processingResult}->'warnings' @> '["לא זוהתה תקופת החשבונית"]'::jsonb`
      )
    );

  console.log(`Found ${stuck.length} stuck row(s).\n`);

  let updated = 0;
  for (const row of stuck) {
    console.log(`── ${row.id} (${row.originalFileName}) ──`);
    console.log(`  stored period: ${row.periodMonth}/${row.periodYear}`);

    if (!row.fileUrl) {
      console.log(`  ↳ no fileUrl, skipping`);
      continue;
    }

    const buf = await downloadBuffer(row.fileUrl);
    const result = await parseMishlohaFile(buf, "application/pdf");

    if (!result.success || !result.data) {
      console.log(`  ↳ parser failed: ${result.errors.join(" | ")}`);
      continue;
    }
    if (!result.data.periodMonth || !result.data.periodYear) {
      console.log(`  ↳ parser still missing period; warnings=${JSON.stringify(result.warnings)}`);
      continue;
    }
    console.log(
      `  ↳ parsed period: ${result.data.periodMonth}/${result.data.periodYear}, total=${result.data.totalAmount}`
    );

    if (
      result.data.periodMonth !== row.periodMonth ||
      result.data.periodYear !== row.periodYear
    ) {
      console.log(
        `  ↳ MISMATCH — parsed period ≠ stored period. Skipping (won't silently change row period).`
      );
      continue;
    }

    if (!apply) continue;

    await database
      .update(clientDocument)
      .set({
        processingResult: result as unknown as Record<string, unknown>,
        processingStatus: "auto_approved",
        totalAmount: result.data.totalAmount.toString(),
        commissionAmount: result.data.commissionAmount.toString(),
        commissionRate: result.data.commissionRate.toString(),
        netAmount: result.data.netAmount.toString(),
        updatedAt: new Date(),
      })
      .where(eq(clientDocument.id, row.id));
    updated++;
    console.log(`  ↳ UPDATED → auto_approved`);
  }

  if (apply) {
    console.log(`\nDone. Updated ${updated} row(s).`);
  } else {
    console.log(`\nDry-run. Pass --apply to write.`);
  }
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
