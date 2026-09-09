/**
 * Re-resolve `failed` rows in `inbound_review_queue` with the CURRENT code.
 *
 * Why this exists: a `failed` row means franchisee resolution lost, not that
 * the file is bad — the PDF is already in Vercel Blob. Once the gap that
 * caused the failure is fixed, every one of those rows should just work, and
 * making Reut hand-assign each one in the review dialog is busywork that
 * also invites a wrong pick.
 *
 * Written for 2026-09-09: ezcount changed the encoding of the customer-name
 * block on Mishloha commission invoices, so eight invoices for period 08/2026
 * (Castra Tomai, Vini Regba, Vini Azrieli, Natanzon Azrieli, King Kong
 * Motzkin/Big/Horev/Hadera) failed with mojibake. Nothing about the script is
 * specific to that incident.
 *
 * Dry-run by default — prints what it WOULD do and writes nothing.
 *
 *   npx tsx scripts/recover-failed-inbound-review.ts --since 2026-09-01
 *   npx tsx scripts/recover-failed-inbound-review.ts --since 2026-09-01 --apply
 *
 * Options:
 *   --since <YYYY-MM-DD>  only rows created on/after this date (default: 30 days)
 *   --client <CODE>       only this client code (e.g. MISHLOCHA)
 *   --apply               actually write
 */
import "dotenv/config";
import { database } from "../src/db";
import {
  inboundReviewQueue,
  franchisee,
  client,
  type Franchisee,
} from "../src/db/schema";
import { and, eq, gte } from "drizzle-orm";
import { resolveFranchisee } from "../src/lib/email/resolve-franchisee";
import { processClientDocument } from "../src/lib/client-document-processor";

function arg(name: string): string | undefined {
  const i = process.argv.indexOf(`--${name}`);
  return i >= 0 ? process.argv[i + 1] : undefined;
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const clientFilter = arg("client")?.toUpperCase();
  const since = arg("since")
    ? new Date(`${arg("since")}T00:00:00`)
    : new Date(Date.now() - 30 * 24 * 60 * 60 * 1000);

  const allFranchisees: Franchisee[] = await database.select().from(franchisee);
  const active = allFranchisees.filter((f) => f.isActive);

  const rows = await database
    .select()
    .from(inboundReviewQueue)
    .where(
      and(
        eq(inboundReviewQueue.status, "failed"),
        gte(inboundReviewQueue.createdAt, since),
      ),
    );

  // Local date parts — toISOString() shifts an Israeli midnight back a day.
  const localDate = (d: Date): string =>
    `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, "0")}-${String(d.getDate()).padStart(2, "0")}`;

  console.log(
    `[recover] ${rows.length} failed row(s) since ${localDate(since)}${
      clientFilter ? ` (client=${clientFilter})` : ""
    }${apply ? "" : " — DRY RUN, nothing will be written"}`,
  );

  let recovered = 0;
  let stillFailing = 0;

  for (const row of rows) {
    const label = `${row.clientCode ?? "?"} "${(row.emailSubject ?? "").slice(0, 50)}"`;

    if (clientFilter && row.clientCode?.toUpperCase() !== clientFilter) continue;
    if (!row.fileUrl || !row.clientId) {
      console.log(`[skip] ${label} — no stored file or client_id`);
      continue;
    }

    const [clientRow] = await database
      .select({ code: client.code, parserCode: client.parserCode })
      .from(client)
      .where(eq(client.id, row.clientId))
      .limit(1);
    const parserCode = clientRow?.parserCode || clientRow?.code || "";
    if (!parserCode) {
      console.log(`[skip] ${label} — client has no parser code`);
      continue;
    }

    const res = await fetch(row.fileUrl);
    if (!res.ok) {
      console.log(`[skip] ${label} — blob download ${res.status}`);
      continue;
    }
    const buffer = Buffer.from(await res.arrayBuffer());

    const documentType =
      row.proposedDocumentType === "commission_invoice"
        ? "commission_invoice"
        : "client_report";

    const resolved = await resolveFranchisee(
      buffer,
      row.mimeType ?? "application/pdf",
      parserCode,
      row.emailSubject ?? "",
      active,
      row.fileName ?? undefined,
      documentType,
      allFranchisees,
    );

    if (!resolved.ok) {
      stillFailing++;
      const why =
        "skipReason" in resolved
          ? `${resolved.skipReason} (${resolved.inactiveFranchiseeName})`
          : resolved.reason;
      console.log(`[still failing] ${label} — ${why}`);
      continue;
    }

    console.log(
      `[recover] ${label} → ${resolved.franchiseeName} @${resolved.confidence?.toFixed(2)}${
        resolved.needsReview ? " [needs_review]" : ""
      } (${documentType}, ${row.periodMonth}/${row.periodYear})`,
    );
    recovered++;
    if (!apply) continue;

    const result = await processClientDocument({
      buffer,
      fileName: row.fileName ?? "inbound-review.pdf",
      mimeType: row.mimeType ?? "application/pdf",
      clientId: row.clientId,
      parserCode,
      franchiseeId: resolved.franchiseeId,
      periodMonth: row.periodMonth ?? new Date().getMonth() + 1,
      periodYear: row.periodYear ?? new Date().getFullYear(),
      documentType,
      source: "gmail_fetch",
      // Same key the webhook used, so a later re-delivery still dedupes.
      gmailMessageId: row.gmailMessageId ?? `recover-${row.id}`,
      // NOT allowReplace: this run is unattended. A slot already filled from
      // another source must stay a conflict for a human, exactly as it would
      // on the live webhook path.
      allowReplace: false,
    });

    if (!result.success || !result.document) {
      console.log(`   ↳ processClientDocument refused: ${result.error ?? "unknown"}`);
      continue;
    }

    await database
      .update(inboundReviewQueue)
      .set({
        // A borderline match keeps its review flag — recovering a row is not
        // the same as verifying it, and Reut still needs to see the ones the
        // matcher was not sure about.
        status: resolved.needsReview ? "needs_review" : "auto_committed",
        committedClientDocumentId: result.document.id,
        proposedFranchiseeId: resolved.franchiseeId,
        proposedFranchiseeName: resolved.franchiseeName,
        reviewNotes: "שוחזר אוטומטית לאחר תיקון זיהוי הזכיין (ח.פ / mojibake)",
        reviewedAt: new Date(),
        updatedAt: new Date(),
      })
      .where(eq(inboundReviewQueue.id, row.id));
    console.log(`   ↳ committed ${result.document.id}`);
  }

  console.log(
    `[recover] done — ${recovered} resolvable, ${stillFailing} still failing${apply ? "" : " (dry run)"}`,
  );
  process.exit(0);
}

main().catch((err) => {
  console.error("Unhandled error:", err);
  process.exit(1);
});
