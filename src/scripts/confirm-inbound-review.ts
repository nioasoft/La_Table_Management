/**
 * CLI equivalent of POST /api/admin/inbound-review/:id/confirm — commit one or
 * more parked (`failed`) inbound queue rows to a chosen franchisee.
 *
 * The HTTP route needs an admin browser session, so recovering a parked row
 * from a terminal previously meant writing yet another one-off fix-*.ts
 * (fix-haat-april-2026, fix-haat-natanzon-june-2026, ...). This replaces that
 * family: same steps, same guards, arguments instead of hardcoded constants.
 *
 * Usage:
 *   npx tsx --env-file=.env src/scripts/confirm-inbound-review.ts \
 *     <queueId>=<franchiseeId>[:<documentType>] [...] [--apply]
 *
 * documentType defaults to the row's proposed_document_type.
 * Dry-run by default: prints the parse result so you can verify the amount
 * before committing (for shared-entity pairs the amount IS the discriminator).
 */

import dns from "node:dns";
dns.setDefaultResultOrder("ipv4first");

import { database } from "@/db";
import { inboundReviewQueue, client, franchisee } from "@/db/schema";
import { eq } from "drizzle-orm";
import { processClientDocument } from "@/lib/client-document-processor";
import { getClientParser, getInvoiceParser } from "@/lib/client-parsers";

type DocumentType = "client_report" | "commission_invoice";

interface Target {
  queueId: string;
  franchiseeId: string;
  documentType?: DocumentType;
}

function parseArgs(argv: readonly string[]): Target[] {
  return argv
    .filter((a) => !a.startsWith("--"))
    .map((arg) => {
      const [queueId, rest] = arg.split("=");
      if (!queueId || !rest) {
        throw new Error(`Bad argument "${arg}" — expected <queueId>=<franchiseeId>[:<type>]`);
      }
      const [franchiseeId, documentType] = rest.split(":");
      if (documentType && documentType !== "client_report" && documentType !== "commission_invoice") {
        throw new Error(`Bad documentType "${documentType}" in "${arg}"`);
      }
      return { queueId, franchiseeId, documentType: documentType as DocumentType | undefined };
    });
}

async function main(): Promise<void> {
  const apply = process.argv.includes("--apply");
  const targets = parseArgs(process.argv.slice(2));
  if (targets.length === 0) {
    console.error("No targets. Usage: <queueId>=<franchiseeId>[:<documentType>] [--apply]");
    process.exit(1);
  }

  console.log(`\n=== confirm-inbound-review (${apply ? "APPLY" : "DRY-RUN"}) ===\n`);
  let failures = 0;

  for (const target of targets) {
    console.log(`── ${target.queueId} ──`);

    const [row] = await database
      .select()
      .from(inboundReviewQueue)
      .where(eq(inboundReviewQueue.id, target.queueId))
      .limit(1);
    if (!row) {
      console.log(`  ✗ queue row not found\n`);
      failures++;
      continue;
    }
    if (row.status === "auto_committed") {
      console.log(`  already committed — skipping\n`);
      continue;
    }
    if (!row.fileUrl || !row.clientId) {
      console.log(`  ✗ row has no file_url / client_id — cannot commit\n`);
      failures++;
      continue;
    }

    const documentType = target.documentType ?? (row.proposedDocumentType as DocumentType | null);
    if (documentType !== "client_report" && documentType !== "commission_invoice") {
      console.log(`  ✗ no usable document type (row proposed "${row.proposedDocumentType}") — pass one explicitly\n`);
      failures++;
      continue;
    }

    const [target_f] = await database
      .select({ id: franchisee.id, name: franchisee.name })
      .from(franchisee)
      .where(eq(franchisee.id, target.franchiseeId))
      .limit(1);
    if (!target_f) {
      console.log(`  ✗ franchisee ${target.franchiseeId} not found\n`);
      failures++;
      continue;
    }

    const [clientRow] = await database
      .select({ code: client.code, parserCode: client.parserCode })
      .from(client)
      .where(eq(client.id, row.clientId))
      .limit(1);
    const parserCode = clientRow?.parserCode || clientRow?.code || "";
    if (!parserCode) {
      console.log(`  ✗ client has no parser_code/code\n`);
      failures++;
      continue;
    }

    console.log(`  subject : ${row.emailSubject}`);
    console.log(`  status  : ${row.status}  period=${row.periodMonth}/${row.periodYear}`);
    console.log(`  reason  : ${row.failureReason ?? "-"}`);

    const res = await fetch(row.fileUrl);
    if (!res.ok) {
      console.log(`  ✗ download failed: HTTP ${res.status}\n`);
      failures++;
      continue;
    }
    const buffer = Buffer.from(await res.arrayBuffer());
    const mimeType = row.mimeType ?? "application/pdf";

    // Read-only parse so the amount is visible before committing.
    const parser =
      documentType === "commission_invoice" ? getInvoiceParser(parserCode) : getClientParser(parserCode);
    if (parser) {
      try {
        const d = (await parser(buffer, mimeType)).data;
        console.log(
          `  parsed  : invoice=${d?.invoiceNumber ?? "?"} total=${d?.totalAmount ?? "?"} commission=${d?.commissionAmount ?? "?"} period=${d?.periodMonth ?? "?"}/${d?.periodYear ?? "?"}`,
        );
      } catch (err) {
        console.log(`  parse warn: ${err instanceof Error ? err.message : String(err)}`);
      }
    }
    console.log(`  → ${documentType} to "${target_f.name}"`);

    if (!apply) {
      console.log(`  (dry-run)\n`);
      continue;
    }

    const result = await processClientDocument({
      buffer,
      fileName: row.fileName ?? "inbound-review.pdf",
      mimeType,
      clientId: row.clientId,
      parserCode,
      franchiseeId: target.franchiseeId,
      periodMonth: row.periodMonth ?? new Date().getMonth() + 1,
      periodYear: row.periodYear ?? new Date().getFullYear(),
      documentType,
      source: "gmail_fetch",
      gmailMessageId: row.gmailMessageId ?? `manual-${row.id}`,
      // Explicit operator choice — same as the admin confirm route.
      allowReplace: true,
    });
    if (!result.success || !result.document) {
      console.log(`  ✗ processClientDocument failed: ${result.error ?? "unknown"}\n`);
      failures++;
      continue;
    }

    await database
      .update(inboundReviewQueue)
      .set({
        status: "auto_committed",
        committedClientDocumentId: result.document.id,
        proposedFranchiseeId: target.franchiseeId,
        proposedDocumentType: documentType,
        reviewedAt: new Date(),
        reviewNotes: `confirm-inbound-review.ts → ${target_f.name}`,
        updatedAt: new Date(),
      })
      .where(eq(inboundReviewQueue.id, row.id));

    console.log(`  ✓ committed client_document ${result.document.id}\n`);
  }

  console.log(apply ? "Done (applied)." : "Done (dry-run). Re-run with --apply to commit.");
  process.exit(failures > 0 ? 1 : 0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
