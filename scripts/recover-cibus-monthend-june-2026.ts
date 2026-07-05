/**
 * Sweep recovery: CIBUS June-2026 month-end reports blocked by daily snapshots.
 *
 * Same slot-collision class as the ezcount receipt incident
 * ([[gotcha-ezcount-receipt-takes-report-slot]]): Pluxee sends a DAILY
 * "Pluxee דוח" snapshot (total ₪0) that took the (CIBUS, franchisee, June)
 * client_report slot on 2026-06-01 — one day before the isCibusDailyReport
 * drop deployed (2026-06-02). The authoritative month-end
 * "ריכוז חיוב חודשי - <franchisee>" then hit the overwrite guard and was
 * parked in inbound_review_queue as `failed`. Result: June CIBUS reconciliation
 * reads ₪0 for 7 franchisees.
 *
 * The month-end is a BODY-BASED html email (no attachment, so the queue row has
 * no fileUrl and parsedData is null) — we re-fetch it from Resend (verified
 * still available 2026-07-05) and re-run processClientDocument with
 * allowReplace, which UPDATES the ₪0 snapshot row in place to the real figures.
 *
 * Idempotent: after --apply the queue rows are auto_committed, so a re-run
 * finds 0 failed rows.
 *
 * Usage:
 *   npx tsx scripts/recover-cibus-monthend-june-2026.ts          # dry-run
 *   npx tsx scripts/recover-cibus-monthend-june-2026.ts --apply  # commit
 */
import "dotenv/config";
import { database } from "../src/db";
import { client, clientDocument, inboundReviewQueue } from "../src/db/schema";
import { and, eq, sql } from "drizzle-orm";
import { fetchInboundEmail } from "../src/lib/email/inbound";
import { processClientDocument } from "../src/lib/client-document-processor";

const TODAY = "2026-07-05";

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  const [cibus] = await database
    .select({ id: client.id, code: client.code, parserCode: client.parserCode })
    .from(client)
    .where(eq(client.code, "CIBUS"))
    .limit(1);
  if (!cibus) throw new Error("CIBUS client not found");
  const parserCode = cibus.parserCode || cibus.code || "";

  const rows = await database
    .select()
    .from(inboundReviewQueue)
    .where(
      and(
        eq(inboundReviewQueue.clientCode, "CIBUS"),
        eq(inboundReviewQueue.status, "failed"),
        sql`${inboundReviewQueue.emailSubject} ILIKE '%ריכוז חיוב חודשי%'`,
      ),
    )
    .orderBy(inboundReviewQueue.periodMonth);

  console.log(`Found ${rows.length} parked CIBUS month-end row(s)${apply ? " — APPLYING" : " — dry-run"}\n`);

  let ok = 0;
  for (const r of rows) {
    const label = `${r.proposedFranchiseeName} ${r.periodMonth}/${r.periodYear}`;
    if (!r.proposedFranchiseeId || !r.gmailMessageId || !r.periodMonth || !r.periodYear) {
      console.log(`SKIP ${label} — missing franchisee/email/period`);
      continue;
    }
    const clientId = r.clientId ?? cibus.id;
    const emailId = r.gmailMessageId.split("#")[0];

    if (!apply) {
      console.log(`WOULD RECOVER ${label} via email ${emailId.slice(0, 8)} (conf=${r.franchiseeConfidence})`);
      continue;
    }

    const email = await fetchInboundEmail(emailId);
    if (!email) {
      console.log(`FAIL ${label} — email ${emailId.slice(0, 8)} not fetchable from Resend`);
      continue;
    }
    const content = email.html || email.text;
    if (!content) {
      console.log(`FAIL ${label} — email has no body`);
      continue;
    }

    const result = await processClientDocument({
      buffer: Buffer.from(content, "utf-8"),
      fileName: `email-${emailId}.${email.html ? "html" : "txt"}`,
      mimeType: email.html ? "text/html" : "text/plain",
      clientId,
      parserCode,
      franchiseeId: r.proposedFranchiseeId,
      periodMonth: r.periodMonth,
      periodYear: r.periodYear,
      documentType: "client_report",
      source: "gmail_fetch",
      gmailMessageId: emailId,
      allowReplace: true,
    });

    if (!result.success || !result.document) {
      console.log(`FAIL ${label} — processClientDocument: ${result.error ?? "unknown"}`);
      continue;
    }
    console.log(`OK   ${label} → doc ${result.document.id.slice(0, 8)} total=${result.document.totalAmount} comm=${result.document.commissionAmount}`);

    const note =
      `[recover-cibus-monthend ${TODAY}] June CIBUS month-end re-ingested: the ` +
      `daily "Pluxee דוח" snapshot (₪0) had taken the slot before the ` +
      `isCibusDailyReport drop deployed, parking the real month-end. ` +
      `Re-fetched from Resend + allowReplace.`;
    await database
      .update(inboundReviewQueue)
      .set({
        status: "auto_committed",
        committedClientDocumentId: result.document.id,
        reviewedAt: new Date(),
        reviewNotes: note,
        updatedAt: new Date(),
      })
      .where(eq(inboundReviewQueue.id, r.id));
    ok++;
  }

  console.log(`\ndone. dry-run=${!apply} recovered=${ok}/${rows.length}`);
  process.exit(0);
}
main().catch((e) => { console.error(e); process.exit(1); });
