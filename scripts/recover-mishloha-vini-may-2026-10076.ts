/**
 * One-off recovery: Mishloha May-2026 client_report for פט ויני עזריאלי חיפה.
 *
 * Incident (Reut 2026-06-11): Mishloha's DIRECT ezcount invoice 10076
 * (פאט ויני עזריאלי בע"מ → לכבוד משלוחה, 31/05/2026, ח.פ 516161361) arrived
 * with the plain subject "חשבונית מס 10076 מאת פאט ויני עזריאלי בע\"מ" and a
 * "[מקור]" body. The classifier (pre-fix) typed it commission_invoice; it
 * collided with Mishloha's real commission invoice 160782 in the same
 * (client, franchisee, period, type) slot, and the overwrite guard parked it
 * in inbound_review_queue (status=failed, x2) instead of overwriting. Result:
 * Vini Azrieli's May Mishloha revenue report never ingested.
 *
 * This script reproduces the admin "inbound-review confirm" path for those
 * queue rows, but pins documentType=client_report (the corrected type):
 *   1. Find the failed queue rows for invoice 10076 on MISHLOCHA.
 *   2. Download the parked PDF from Vercel Blob.
 *   3. Run processClientDocument({ documentType: "client_report",
 *      franchiseeId: <פט ויני עזריאלי חיפה>, allowReplace: true, ... }).
 *   4. Link BOTH queue rows to the resulting client_document and close them.
 *
 * Idempotent: if a client_report already exists for
 * (MISHLOCHA, פט ויני עזריאלי חיפה, 5/2026) it skips creation and only closes
 * the queue rows. gmailMessageId is reused so a re-delivery won't duplicate.
 *
 * Usage:
 *   npx tsx scripts/recover-mishloha-vini-may-2026-10076.ts          # dry-run
 *   npx tsx scripts/recover-mishloha-vini-may-2026-10076.ts --apply  # commit
 */
import "dotenv/config";
import { database } from "../src/db";
import {
  client,
  clientDocument,
  franchisee,
  inboundReviewQueue,
} from "../src/db/schema";
import { and, eq } from "drizzle-orm";
import { processClientDocument } from "../src/lib/client-document-processor";

const CLIENT_CODE = "MISHLOCHA";
const FRANCHISEE_NAME = "פט ויני עזריאלי חיפה";
const PERIOD_MONTH = 5;
const PERIOD_YEAR = 2026;
const INVOICE_SUBSTRING = "10076";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const today = new Date().toISOString().slice(0, 10);

  // Resolve the target client + franchisee.
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

  // Find the failed queue rows for invoice 10076 on this client.
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
    `[recover-10076] client=${clientRow.id.slice(0, 8)} franchisee=${franchiseeRow.id.slice(0, 8)} ` +
      `parserCode=${parserCode} — found ${targets.length} failed queue row(s)${apply ? " — APPLYING" : " — dry-run"}`,
  );
  if (targets.length === 0) {
    console.log("[recover-10076] nothing to do (already recovered?).");
    process.exit(0);
  }

  // Is there already a client_report in the target slot?
  const [existing] = await database
    .select({ id: clientDocument.id })
    .from(clientDocument)
    .where(
      and(
        eq(clientDocument.clientId, clientRow.id),
        eq(clientDocument.franchiseeId, franchiseeRow.id),
        eq(clientDocument.periodMonth, PERIOD_MONTH),
        eq(clientDocument.periodYear, PERIOD_YEAR),
        eq(clientDocument.documentType, "client_report"),
      ),
    )
    .limit(1);

  let committedDocId = existing?.id ?? null;
  if (committedDocId) {
    console.log(
      `[recover-10076] client_report already exists for slot → ${committedDocId.slice(0, 8)}; will just close queue rows`,
    );
  }

  // Create the client_report from the first queue row's parked file.
  if (!committedDocId) {
    const primary = targets[0];
    if (!primary.fileUrl) throw new Error("primary queue row has no fileUrl");
    console.log(
      `[recover-10076] ${apply ? "PROCESS" : "WOULD PROCESS"} ${primary.id.slice(0, 8)} ` +
        `subject="${primary.emailSubject}" file=${primary.fileName} gmailMessageId=${primary.gmailMessageId}`,
    );

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
        `[recover-10076] created client_document ${committedDocId.slice(0, 8)} ` +
          `total=${result.document.totalAmount} comm=${result.document.commissionAmount}`,
      );
    }
  }

  // Close every matching queue row, linking to the committed document.
  const note =
    `[recover-10076 ${today}] Recovered manually: direct-ezcount franchisee ` +
    `invoice 10076 (פאט ויני עזריאלי → משלוחה, May 2026) was mis-typed ` +
    `commission_invoice and blocked by the overwrite guard vs 160782. ` +
    `Re-committed as client_report. Classifier fixed so this no longer recurs.`;
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

  console.log(`\n[recover-10076] done. dry-run=${!apply} document=${committedDocId ?? "(none)"}`);
  process.exit(0);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
