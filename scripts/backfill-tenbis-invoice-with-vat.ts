/**
 * Backfill historic Tnbis (10bis / TENBIS) commission-invoice rows so the
 * headline amount matches the new with-VAT convention introduced in
 * src/lib/client-parsers/invoice-tenbis-parser.ts.
 *
 * Why:
 *   The Tnbis invoice parser used to set totalAmount = commissionAmount =
 *   preVatTotal (e.g. ₪3,978.81) and netAmount = grandTotal (e.g. ₪4,695.00).
 *   We now follow the Cibus/HAAT/Mishloha/Wolt convention where the headline
 *   IS the with-VAT grand total: totalAmount = commissionAmount = netAmount.
 *   Going forward, new invoices land with the correct values; this script
 *   updates the historic rows so reconciliation stays consistent across all
 *   periods.
 *
 * Strategy (no PDF reparsing needed — net_amount already holds the with-VAT
 * grand total, set by client-document-processor.ts:234 from the parser's
 * grandTotal):
 *
 *   UPDATE client_document
 *      SET total_amount = net_amount,
 *          commission_amount = net_amount,
 *          updated_at = NOW()
 *    WHERE client_id = (TENBIS client id)
 *      AND document_type = 'commission_invoice'
 *      AND net_amount IS NOT NULL
 *      AND total_amount <> net_amount;
 *
 * Idempotent: the inequality predicate excludes rows already at the correct
 * value, so reruns are no-ops.
 *
 * Rows where net_amount IS NULL (parser failed to extract grand total at
 * import time) are skipped and reported — they need a separate PDF reparse
 * which is out of scope here.
 *
 * processingResult (the original parser-output JSON) is left untouched so the
 * audit trail of what the parser actually emitted at import time is preserved.
 *
 * Usage:
 *   npx tsx scripts/backfill-tenbis-invoice-with-vat.ts            # dry run
 *   npx tsx scripts/backfill-tenbis-invoice-with-vat.ts --apply    # write
 */
import "dotenv/config";
import { and, eq, isNotNull, sql } from "drizzle-orm";
import { database } from "../src/db";
import { client, clientDocument } from "../src/db/schema";

const APPLY = process.argv.includes("--apply");

async function main() {
  console.log(
    `Tnbis with-VAT backfill — mode: ${APPLY ? "APPLY (writes)" : "DRY RUN"}\n`
  );

  // 1. Resolve TENBIS client id
  const tenbisRows = await database
    .select({ id: client.id, code: client.code, name: client.name })
    .from(client)
    .where(eq(client.code, "TENBIS"));

  if (tenbisRows.length === 0) {
    console.log("TENBIS client not found — nothing to do.");
    return;
  }
  const tenbis = tenbisRows[0];
  console.log(`Tnbis client: ${tenbis.name} (${tenbis.code})  id=${tenbis.id}\n`);

  // 2. All Tnbis commission_invoice rows — for the report
  const allInvoiceRows = await database
    .select({
      id: clientDocument.id,
      periodMonth: clientDocument.periodMonth,
      periodYear: clientDocument.periodYear,
      totalAmount: clientDocument.totalAmount,
      commissionAmount: clientDocument.commissionAmount,
      netAmount: clientDocument.netAmount,
      originalFileName: clientDocument.originalFileName,
    })
    .from(clientDocument)
    .where(
      and(
        eq(clientDocument.clientId, tenbis.id),
        eq(clientDocument.documentType, "commission_invoice")
      )
    );

  // 3. Categorise: needs-update / null-net / already-correct
  const skippedNullNet = allInvoiceRows.filter((r) => r.netAmount === null);
  const candidates = allInvoiceRows.filter(
    (r) => r.netAmount !== null && r.totalAmount !== r.netAmount
  );
  const alreadyCorrect = allInvoiceRows.filter(
    (r) => r.netAmount !== null && r.totalAmount === r.netAmount
  );

  console.log(
    `Total Tnbis commission_invoice rows: ${allInvoiceRows.length}`
  );
  console.log(`  to update: ${candidates.length}`);
  console.log(`  already correct (no-op): ${alreadyCorrect.length}`);
  console.log(`  skipped (net_amount IS NULL): ${skippedNullNet.length}`);

  if (candidates.length > 0) {
    console.log("\nSample (up to 10) of rows that will change:");
    for (const r of candidates.slice(0, 10)) {
      const period = `${String(r.periodMonth).padStart(2, "0")}/${r.periodYear}`;
      console.log(
        `  ${period}  total=${r.totalAmount}  net=${r.netAmount}  ${(r.originalFileName ?? "?").slice(0, 50)}`
      );
    }
  }

  if (skippedNullNet.length > 0) {
    console.log("\nSample (up to 5) of rows skipped because net_amount IS NULL:");
    for (const r of skippedNullNet.slice(0, 5)) {
      const period = `${String(r.periodMonth).padStart(2, "0")}/${r.periodYear}`;
      console.log(
        `  ${period}  total=${r.totalAmount}  net=NULL  ${(r.originalFileName ?? "?").slice(0, 50)}`
      );
    }
  }

  if (candidates.length === 0) {
    console.log("\nNothing to update. Done.");
    return;
  }

  if (!APPLY) {
    console.log("\nDry-run only. Re-run with --apply to write updates.");
    return;
  }

  // 4. Single atomic UPDATE — same predicate as the candidates filter so it's
  //    idempotent and safe under concurrent inserts (a new invoice arriving
  //    mid-script either already has the correct values or matches and gets
  //    fixed too).
  const updateResult = await database
    .update(clientDocument)
    .set({
      totalAmount: sql`${clientDocument.netAmount}`,
      commissionAmount: sql`${clientDocument.netAmount}`,
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(clientDocument.clientId, tenbis.id),
        eq(clientDocument.documentType, "commission_invoice"),
        isNotNull(clientDocument.netAmount),
        sql`${clientDocument.totalAmount} <> ${clientDocument.netAmount}`
      )
    )
    .returning({ id: clientDocument.id });

  console.log(`\nUpdated ${updateResult.length} row(s).`);
  // Sanity check: number updated should equal the dry-run candidate count
  // (modulo concurrent inserts).
  if (updateResult.length !== candidates.length) {
    console.log(
      `Note: dry-run found ${candidates.length} candidates but UPDATE touched ${updateResult.length}. ` +
        `Likely a concurrent insert/update — re-run dry-run to confirm zero remain.`
    );
  }
}

main()
  .catch((err) => {
    console.error("Fatal error:", err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
