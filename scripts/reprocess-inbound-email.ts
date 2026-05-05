/**
 * Reprocess a failed inbound email by ID.
 *
 * Mirrors the post-signature-verification flow of
 * /api/clients/email-inbound/route.ts but skips Resend's webhook signature
 * check (we already trust the Resend Inbound API as the source of truth).
 *
 * Use when an email was rejected at delivery time due to a parser/extractor
 * gap and needs to be reprocessed once the gap is fixed. processClientDocument
 * dedupes on gmailMessageId, so re-running once the email has been
 * successfully ingested is a no-op.
 *
 * Usage:
 *   npx tsx scripts/reprocess-inbound-email.ts <emailId> [<emailId> ...]
 */
import "dotenv/config";
import {
  fetchInboundEmail,
  downloadAttachment,
  identifyClientFromEmail,
  resolvePeriod,
} from "../src/lib/email/inbound";
import { processClientDocument } from "../src/lib/client-document-processor";
import { getClientParser, getInvoiceParser } from "../src/lib/client-parsers";
import { matchFranchiseeName } from "../src/lib/franchisee-matcher";
import { detectDocumentType } from "../src/lib/email/classify-document-type";
import { database } from "../src/db";
import { franchisee, type Franchisee } from "../src/db/schema";
import { eq } from "drizzle-orm";

const UNKNOWN = new Set(["לא זוהה", "Unknown", "unknown"]);

async function resolveFranchisee(
  buffer: Buffer,
  mimeType: string,
  parserCode: string,
  subject: string,
  franchisees: Franchisee[],
  attachmentFilename: string | undefined,
  documentType: "client_report" | "commission_invoice"
): Promise<{ franchiseeId: string; franchiseeName: string } | null> {
  const parser =
    documentType === "commission_invoice"
      ? getInvoiceParser(parserCode)
      : getClientParser(parserCode);
  if (parser) {
    try {
      const r = await parser(buffer, mimeType);
      const name = r.data?.franchiseeName;
      if (r.success && name && !UNKNOWN.has(name)) {
        const m = matchFranchiseeName(name, franchisees, { minConfidence: 0.6 });
        if (m.matchedFranchisee) {
          console.log(
            `  matched from content: "${name}" → "${m.matchedFranchisee.name}"`
          );
          return {
            franchiseeId: m.matchedFranchisee.id,
            franchiseeName: m.matchedFranchisee.name,
          };
        }
        console.log(
          `  parser extracted "${name}" but no alias matched ≥0.6`
        );
      }
    } catch (err) {
      console.warn("  parser error:", err);
    }
  }
  if (attachmentFilename) {
    const m = matchFranchiseeName(
      attachmentFilename.replace(/\.[^.]+$/, ""),
      franchisees,
      { minConfidence: 0.6 }
    );
    if (m.matchedFranchisee) {
      console.log(`  matched from filename → "${m.matchedFranchisee.name}"`);
      return {
        franchiseeId: m.matchedFranchisee.id,
        franchiseeName: m.matchedFranchisee.name,
      };
    }
  }
  const fromSubject = matchFranchiseeName(subject, franchisees, {
    minConfidence: 0.6,
  });
  if (fromSubject.matchedFranchisee) {
    console.log(`  matched from subject → "${fromSubject.matchedFranchisee.name}"`);
    return {
      franchiseeId: fromSubject.matchedFranchisee.id,
      franchiseeName: fromSubject.matchedFranchisee.name,
    };
  }
  return null;
}

async function extractAndDownloadInvoiceOneLinks(
  htmlBody: string
): Promise<Array<{ buffer: Buffer; fileName: string }>> {
  const matches = [
    ...htmlBody.matchAll(
      /https?:\/\/(?:www\.)?invoice-one\.com\/ViewerNew\/pages\/Y_GreeViewer_document\/(\w+)/gi
    ),
  ];
  const docIds = [...new Set(matches.map((m) => m[1]))];
  const out: Array<{ buffer: Buffer; fileName: string }> = [];
  for (const docId of docIds) {
    const url = `https://invoice-one.com/ViewerNew/api/GreeViewer/Document/Download?DocumentID=${docId}`;
    console.log(`  downloading ${url}`);
    const r = await fetch(url);
    if (!r.ok) {
      console.warn(`  HTTP ${r.status} — skipping`);
      continue;
    }
    const ct = r.headers.get("content-type") ?? "";
    if (!ct.includes("octet-stream") && !ct.includes("application/pdf")) {
      console.warn(`  content-type ${ct} — skipping`);
      continue;
    }
    out.push({
      buffer: Buffer.from(await r.arrayBuffer()),
      fileName: `tenbis-invoice-${docId}.pdf`,
    });
  }
  return out;
}

async function processOne(emailId: string) {
  console.log(`\n=== ${emailId} ===`);
  const email = await fetchInboundEmail(emailId);
  if (!email) {
    console.error("  could not fetch from Resend");
    return;
  }
  console.log(`  from=${email.from}  subject="${email.subject}"`);

  const ic = await identifyClientFromEmail(email.to, email.from, email.subject);
  if (!ic) {
    console.error("  client not identified");
    return;
  }
  console.log(`  client=${ic.clientCode} (by ${ic.identifiedBy})`);

  const period = resolvePeriod(email.subject, email.createdAt);
  const documentType = detectDocumentType(email.subject);
  console.log(`  documentType=${documentType}  period=${period.month}/${period.year}`);

  const allFranchisees = (await database
    .select()
    .from(franchisee)
    .where(eq(franchisee.isActive, true))) as Franchisee[];

  // Mirror the attachment-based branch only — that's where these failed.
  let buffers: Array<{ buffer: Buffer; fileName: string; mimeType: string }> = [];

  for (const a of email.attachments) {
    if (
      a.contentType === "application/pdf" ||
      a.filename.toLowerCase().endsWith(".pdf")
    ) {
      const b = await downloadAttachment(a.downloadUrl);
      if (b) buffers.push({ buffer: b, fileName: a.filename, mimeType: a.contentType });
    }
  }

  if (buffers.length === 0 && ic.clientCode === "TENBIS") {
    const links = await extractAndDownloadInvoiceOneLinks(email.html ?? "");
    buffers = links.map((l) => ({ ...l, mimeType: "application/pdf" }));
  }

  if (buffers.length === 0) {
    console.error("  no PDFs found via attachments or links");
    return;
  }

  for (const b of buffers) {
    const fr = await resolveFranchisee(
      b.buffer,
      b.mimeType,
      ic.parserCode,
      email.subject,
      allFranchisees,
      b.fileName,
      documentType
    );
    if (!fr) {
      console.error(`  franchisee not resolved for ${b.fileName}`);
      continue;
    }
    const r = await processClientDocument({
      buffer: b.buffer,
      fileName: b.fileName,
      mimeType: b.mimeType,
      clientId: ic.clientId,
      parserCode: ic.parserCode,
      franchiseeId: fr.franchiseeId,
      periodMonth: period.month,
      periodYear: period.year,
      documentType,
      source: "gmail_fetch",
      gmailMessageId: emailId,
    });
    if (r.skippedDuplicate) {
      console.log(`  ${b.fileName} → skipped (duplicate)`);
    } else if (r.success) {
      console.log(`  ${b.fileName} → CREATED for ${fr.franchiseeName}`);
    } else {
      console.error(`  ${b.fileName} → FAILED: ${r.error}`);
    }
  }
}

async function main() {
  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("Usage: npx tsx scripts/reprocess-inbound-email.ts <emailId> [<emailId> ...]");
    process.exit(1);
  }
  for (const id of ids) await processOne(id);
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .finally(() => process.exit(0));
