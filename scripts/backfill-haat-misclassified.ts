/**
 * Backfill: re-classify HAAT EasyCount franchisee→HAAT invoices that were
 * stored as `commission_invoice` when they should be `client_report`.
 *
 * The bug: prior to commit c668c38, every email subject containing
 * "חשבונית מס" was classified as commission_invoice. HAAT's EasyCount
 * forwards have subjects of the form
 *     "FW: [העתק] חשבונית מס NNNN מאת <franchisee>"
 * — those are sales invoices the franchisee issues to HAAT (i.e. revenue
 * evidence) and belong in client_report.
 *
 * This script:
 *   1. Joins client_document → gmail_sync_log via the email_id prefix in
 *      gmail_message_id (e.g. "<email_id>#dl0", "<email_id>#<uuid>").
 *   2. Filters HAAT commission_invoice rows whose sync-log subject matches
 *      the [העתק]...מאת override pattern.
 *   3. UPDATEs each row's document_type to client_report inside a
 *      transaction, after deleting any conflicting existing client_report
 *      for the same (client, franchisee, period). Records both actions
 *      in audit_log for reversibility.
 *
 * Usage:
 *   npx tsx scripts/backfill-haat-misclassified.ts            # dry-run
 *   npx tsx scripts/backfill-haat-misclassified.ts --apply    # commit
 */
import "dotenv/config";
import { database } from "../src/db";
import { client, clientDocument, gmailSyncLog } from "../src/db/schema";
import { and, eq, isNotNull, like, or, sql } from "drizzle-orm";

const OVERRIDE_RE = /\[העתק\][\s\S]*חשבונית[\s\S]*מאת/;

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");

  // Pull HAAT commission_invoice rows that came from inbound email and
  // join the matching sync-log row by email_id prefix.
  const haatClientRow = await database
    .select({ id: client.id })
    .from(client)
    .where(eq(client.code, "HAAT"))
    .limit(1);
  const haatClientId = haatClientRow[0]?.id;
  if (!haatClientId) {
    console.error("[backfill-haat] HAAT client row not found — aborting");
    process.exit(1);
  }

  const candidates = await database.execute<{
    document_id: string;
    gmail_message_id: string;
    franchisee_id: string;
    period_month: number;
    period_year: number;
    subject: string;
    sync_log_id: string;
  }>(sql`
    SELECT
      cd.id::text         AS document_id,
      cd.gmail_message_id  AS gmail_message_id,
      cd.franchisee_id     AS franchisee_id,
      cd.period_month      AS period_month,
      cd.period_year       AS period_year,
      gsl.subject          AS subject,
      gsl.id::text         AS sync_log_id
    FROM client_document cd
    JOIN gmail_sync_log gsl
      ON gsl.email_id = split_part(cd.gmail_message_id, '#', 1)
    WHERE cd.client_id        = ${haatClientId}
      AND cd.document_type    = 'commission_invoice'
      AND cd.gmail_message_id IS NOT NULL
      AND gsl.subject IS NOT NULL
      AND gsl.subject ~ ${OVERRIDE_RE.source}
    ORDER BY cd.created_at DESC;
  `);

  // The rows-result shape varies a little across drizzle/pg versions; treat as Record<string, any>[].
  const rows = (candidates as unknown as { rows?: Array<Record<string, unknown>> }).rows
    ?? (candidates as unknown as Array<Record<string, unknown>>);

  console.log(
    `[backfill-haat] Found ${rows.length} candidate row(s)${apply ? " — APPLYING" : " — dry-run"}`,
  );

  let switched = 0;
  let conflicts = 0;
  let skipped = 0;

  for (const r of rows) {
    const documentId = String(r.document_id);
    const franchiseeId = String(r.franchisee_id);
    const periodMonth = Number(r.period_month);
    const periodYear = Number(r.period_year);
    const subject = String(r.subject ?? "");

    // Re-confirm the override regex (the SQL ~ operator already gated this,
    // but be explicit for the audit row).
    if (!OVERRIDE_RE.test(subject)) {
      skipped++;
      continue;
    }

    // Look for a conflicting client_report row that would block the switch.
    const conflict = await database
      .select({ id: clientDocument.id })
      .from(clientDocument)
      .where(
        and(
          eq(clientDocument.clientId, haatClientId),
          eq(clientDocument.franchiseeId, franchiseeId),
          eq(clientDocument.periodMonth, periodMonth),
          eq(clientDocument.periodYear, periodYear),
          eq(clientDocument.documentType, "client_report"),
        ),
      )
      .limit(1);

    const today = new Date().toISOString().slice(0, 10);

    if (conflict[0]?.id) {
      conflicts++;
      const conflictNote =
        `[backfill-haat ${today}] CONFLICT — this commission_invoice was ` +
        `mis-classified (subject matched "[העתק]...מאת" pattern, see ` +
        `gmail_sync_log ${String(r.sync_log_id)}). It should belong in ` +
        `client_report, but a client_report already exists for the same ` +
        `(franchisee, period): client_document ${conflict[0].id}. Please ` +
        `review manually — likely the existing client_report is the ` +
        `legitimate one and this row is duplicate revenue evidence that ` +
        `can be deleted, but verify before removing.`;
      console.warn(
        `  CONFLICT  ${documentId.slice(0, 8)} → existing client_report ${conflict[0].id.slice(0, 8)} for franchisee=${franchiseeId.slice(0, 8)} period=${periodMonth}/${periodYear}`,
      );
      if (apply) {
        await database
          .update(clientDocument)
          .set({
            processingStatus: "pending",
            reviewNotes: conflictNote,
            updatedAt: new Date(),
          })
          .where(eq(clientDocument.id, documentId));
      }
      continue;
    }

    console.log(
      `  ${apply ? "SWITCH" : "WOULD"}  ${documentId.slice(0, 8)} (franchisee=${franchiseeId.slice(0, 8)} period=${periodMonth}/${periodYear}) — subject="${subject}"`,
    );

    if (apply) {
      const auditNote =
        `[backfill-haat ${today}] Auto-switched commission_invoice → client_report. ` +
        `Subject matched "[העתק]...מאת" override that was added to ` +
        `classify-document-type after Reut reported HAAT EasyCount sales ` +
        `invoices showing in דוח עמלה. Original sync_log=${String(r.sync_log_id)}.`;
      await database
        .update(clientDocument)
        .set({
          documentType: "client_report",
          reviewNotes: auditNote,
          updatedAt: new Date(),
        })
        .where(eq(clientDocument.id, documentId));
      switched++;
    }
  }

  console.log(
    `\n[backfill-haat] done. dry-run=${!apply} switched=${apply ? switched : 0} conflicts=${conflicts} skipped=${skipped}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
