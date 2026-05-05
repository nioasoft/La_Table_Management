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

/** Clients whose `client_report` arrives in the email body, not attached. */
const BODY_BASED_CLIENTS = new Set(["CIBUS"]);

export interface ReprocessResult {
  success: boolean;
  documentsCreated: number;
  duplicatesSkipped: number;
  errors: string[];
}

export async function reprocessEmail(emailId: string): Promise<ReprocessResult> {
  const result: ReprocessResult = {
    success: false,
    documentsCreated: 0,
    duplicatesSkipped: 0,
    errors: [],
  };

  console.log(`\n=== ${emailId} ===`);
  const email = await fetchInboundEmail(emailId);
  if (!email) {
    result.errors.push("could not fetch from Resend");
    return result;
  }
  console.log(`  from=${email.from}  subject="${email.subject}"`);

  const ic = await identifyClientFromEmail(email.to, email.from, email.subject);
  if (!ic) {
    result.errors.push("client not identified");
    return result;
  }
  console.log(`  client=${ic.clientCode} (by ${ic.identifiedBy})`);

  const period = resolvePeriod(email.subject, email.createdAt);
  const documentType = detectDocumentType(email.subject);
  console.log(`  documentType=${documentType}  period=${period.month}/${period.year}`);

  const allFranchisees = (await database
    .select()
    .from(franchisee)
    .where(eq(franchisee.isActive, true))) as Franchisee[];

  // Body-based path: matches route.ts. Used for CIBUS report emails and
  // for the post-2026-05-05 TENBIS HTML report shape.
  const tenbisInlineHtmlReport =
    ic.clientCode.toUpperCase() === "TENBIS" &&
    documentType === "client_report" &&
    email.attachments.length === 0 &&
    /למסעדת|פירוט\s+עסקאות|תן\s+ביס/.test(email.html || email.text || "");

  const isBodyBased =
    (BODY_BASED_CLIENTS.has(ic.clientCode.toUpperCase()) &&
      documentType !== "commission_invoice") ||
    tenbisInlineHtmlReport;

  if (isBodyBased) {
    const content = email.html || email.text || "";
    if (!content) {
      result.errors.push("body-based but no HTML/text body");
      return result;
    }
    const buf = Buffer.from(content, "utf-8");
    const mimeType = email.html ? "text/html" : "text/plain";
    const fr = await resolveFranchisee(
      buf,
      mimeType,
      ic.parserCode,
      email.subject,
      allFranchisees,
      undefined,
      documentType,
    );
    if (!fr) {
      result.errors.push("franchisee not resolved from body");
      return result;
    }
    const r = await processClientDocument({
      buffer: buf,
      fileName: `email-${emailId}.${email.html ? "html" : "txt"}`,
      mimeType,
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
      result.duplicatesSkipped++;
      console.log(`  body → skipped (duplicate) for ${fr.franchiseeName}`);
    } else if (r.success) {
      result.documentsCreated++;
      console.log(`  body → CREATED for ${fr.franchiseeName}`);
    } else {
      result.errors.push(`body → FAILED: ${r.error}`);
    }
    result.success = result.errors.length === 0;
    return result;
  }

  // Attachment-based path
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
    result.errors.push("no PDFs found via attachments or links");
    return result;
  }

  for (const b of buffers) {
    const fr = await resolveFranchisee(
      b.buffer,
      b.mimeType,
      ic.parserCode,
      email.subject,
      allFranchisees,
      b.fileName,
      documentType,
    );
    if (!fr) {
      result.errors.push(`franchisee not resolved for ${b.fileName}`);
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
      result.duplicatesSkipped++;
      console.log(`  ${b.fileName} → skipped (duplicate)`);
    } else if (r.success) {
      result.documentsCreated++;
      console.log(`  ${b.fileName} → CREATED for ${fr.franchiseeName}`);
    } else {
      result.errors.push(`${b.fileName} → FAILED: ${r.error}`);
    }
  }

  result.success = result.documentsCreated > 0 || result.duplicatesSkipped > 0;
  return result;
}

async function main() {
  // Skip CLI driver when imported as a library (`reprocess-failed-inbound.ts`).
  const isDirectCli =
    typeof require !== "undefined" &&
    typeof require.main !== "undefined" &&
    require.main === module;
  if (!isDirectCli) return;

  const ids = process.argv.slice(2);
  if (ids.length === 0) {
    console.error("Usage: npx tsx scripts/reprocess-inbound-email.ts <emailId> [<emailId> ...]");
    process.exit(1);
  }
  for (const id of ids) await reprocessEmail(id);
}

main()
  .catch((err) => {
    console.error("Fatal:", err);
    process.exit(1);
  })
  .finally(() => {
    if (typeof require !== "undefined" && require.main === module) {
      process.exit(0);
    }
  });
