/**
 * One-off recovery: HAAT June-2026 client_report for קינג קונג חורב בע"מ.
 *
 * Incident (Reut/מינה, 2026-07): the franchisee issues both a "חשבונית מס" and
 * a "קבלה" (payment receipt) per period. Receipt 20007 (₪17,385.98, bank
 * transfer) arrived 2026-06-15, fell through the classifier to the default
 * client_report, and grabbed the single (HAAT, קינג קונג חורב, June) report
 * slot. When the real tax invoice 10052 (₪22,061) arrived 2026-07-01 the
 * overwrite guard refused to replace the receipt and parked 10052 in
 * inbound_review_queue (status=failed, x2). Reconciliation therefore showed
 * the receipt's ₪17,385.98 instead of the invoice's ₪22,061.
 *
 * The classifier now drops receipts on arrival (isReceiptDocument), so this
 * no longer recurs. This script fixes the June data by reproducing the admin
 * "inbound-review confirm" path for the parked 10052 rows:
 *   1. Find the failed queue rows for invoice 10052 on HAAT / קינג קונג חורב.
 *   2. Download the parked PDF from Vercel Blob.
 *   3. Run processClientDocument({ documentType: "client_report",
 *      allowReplace: true, ... }) — UPDATES the receipt row in place to 10052.
 *   4. Link BOTH queue rows to the resulting client_document and close them.
 *
 * Idempotent: after --apply the queue rows are auto_committed, so a second run
 * finds 0 failed rows and does nothing.
 *
 * Usage:
 *   npx tsx scripts/recover-haat-horev-10052-june-2026.ts          # dry-run
 *   npx tsx scripts/recover-haat-horev-10052-june-2026.ts --apply  # commit
 */
import "dotenv/config";
import { database } from "../src/db";
import { client, franchisee, inboundReviewQueue } from "../src/db/schema";
import { and, eq } from "drizzle-orm";
import { processClientDocument } from "../src/lib/client-document-processor";

const CLIENT_CODE = "HAAT";
const FRANCHISEE_NAME = 'קינג קונג חורב בע"מ';
const PERIOD_MONTH = 6;
const PERIOD_YEAR = 2026;
const INVOICE_SUBSTRING = "10052";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const today = "2026-07-05";

  const [clientRow] = await database
    .select({ id: client.id, code: client.code, parserCode: client.parserCode })
    .from(client)
    .where(eq(client.code, CLIENT_CODE))
    .limit(1);
  if (!clientRow) throw new Error(`Client ${CLIENT_CODE} not found`);

  const [franchiseeRow] = await database
    .select({ id: franchisee.id, name: franchisee.name })
    .from(franchisee)
    .where(eq(franchisee.name, FRANCHISEE_NAME))
    .limit(1);
  if (!franchiseeRow) throw new Error(`Franchisee "${FRANCHISEE_NAME}" not found`);

  const parserCode = clientRow.parserCode || clientRow.code || "";

  const queueRows = await database
    .select()
    .from(inboundReviewQueue)
    .where(
      and(
        eq(inboundReviewQueue.clientCode, CLIENT_CODE),
        eq(inboundReviewQueue.status, "failed"),
      ),
    );
  const targets = queueRows.filter((r) =>
    (r.emailSubject ?? "").includes(INVOICE_SUBSTRING),
  );

  console.log(
    `[recover-10052] client=${clientRow.id.slice(0, 8)} franchisee=${franchiseeRow.id.slice(0, 8)} ` +
      `parserCode=${parserCode} — found ${targets.length} failed queue row(s)${apply ? " — APPLYING" : " — dry-run"}`,
  );
  if (targets.length === 0) {
    console.log("[recover-10052] nothing to do (already recovered?).");
    process.exit(0);
  }

  // Process the first parked file with allowReplace — UPDATES the receipt
  // sitting in the (HAAT, קינג קונג חורב, June) client_report slot in place.
  const primary = targets[0];
  if (!primary.fileUrl) throw new Error("primary queue row has no fileUrl");
  console.log(
    `[recover-10052] ${apply ? "PROCESS" : "WOULD PROCESS"} ${primary.id.slice(0, 8)} ` +
      `subject="${primary.emailSubject}" file=${primary.fileName} gmailMessageId=${primary.gmailMessageId}`,
  );

  let committedDocId: string | null = null;
  if (apply) {
    const res = await fetch(primary.fileUrl);
    if (!res.ok) throw new Error(`download failed: ${res.status}`);
    const buffer = Buffer.from(await res.arrayBuffer());

    const result = await processClientDocument({
      buffer,
      fileName: primary.fileName ?? "ezcount-invoice.pdf",
      mimeType: primary.mimeType ?? "application/pdf",
      clientId: clientRow.id,
      parserCode,
      franchiseeId: franchiseeRow.id,
      periodMonth: primary.periodMonth ?? PERIOD_MONTH,
      periodYear: primary.periodYear ?? PERIOD_YEAR,
      documentType: "client_report",
      source: "gmail_fetch",
      gmailMessageId: primary.gmailMessageId ?? `manual-${primary.id}`,
      allowReplace: true,
    });

    if (!result.success || !result.document) {
      throw new Error(`processClientDocument failed: ${result.error ?? "unknown"}`);
    }
    committedDocId = result.document.id;
    console.log(
      `[recover-10052] client_document ${committedDocId.slice(0, 8)} ` +
        `total=${result.document.totalAmount} net=${result.document.netAmount} ` +
        `invoiceNumber=${result.document.invoiceNumber} (expected total ≈ 22061, invoice 10052)`,
    );
  }

  const note =
    `[recover-10052 ${today}] Recovered manually: HAAT tax invoice 10052 ` +
    `(קינג קונג חורב, June 2026, ₪22,061) was blocked by the overwrite guard ` +
    `because receipt 20007 (₪17,385.98) had taken the client_report slot. ` +
    `Re-committed as client_report (allowReplace). Classifier now drops ` +
    `receipts on arrival so this no longer recurs.`;
  for (const r of targets) {
    console.log(
      `  ${apply ? "CLOSE" : "WOULD CLOSE"} queue ${r.id.slice(0, 8)} → ${committedDocId ? committedDocId.slice(0, 8) : "(dry)"}`,
    );
    if (apply) {
      await database
        .update(inboundReviewQueue)
        .set({
          status: "auto_committed",
          committedClientDocumentId: committedDocId,
          proposedFranchiseeId: franchiseeRow.id,
          proposedDocumentType: "client_report",
          reviewedAt: new Date(),
          reviewNotes: note,
          updatedAt: new Date(),
        })
        .where(eq(inboundReviewQueue.id, r.id));
    }
  }

  console.log(`\n[recover-10052] done. dry-run=${!apply} document=${committedDocId ?? "(none)"}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
