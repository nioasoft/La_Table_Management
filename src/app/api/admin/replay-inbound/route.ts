/**
 * POST /api/admin/replay-inbound — Replay one or more failed inbound emails.
 *
 * Use case: an inbound email was rejected by the webhook (parser bug,
 * missing PDF link extractor, etc.) and now that the underlying issue is
 * fixed we want to re-process the original messages without asking the
 * sender to resend.
 *
 * Authentication: super_user session OR `Authorization: Bearer <CRON_SECRET>`.
 *
 * Body: `{ "emailIds": ["uuid", ...] }` — Resend Inbound email IDs.
 *
 * Per email the handler:
 *   1. Fetches the original message from Resend.
 *   2. Identifies the client.
 *   3. Runs the same body-vs-attachment-vs-extracted-link flow as the
 *      live webhook (without re-verifying signatures, since the message
 *      already passed signature verification when it first arrived).
 *
 * Idempotent: documents that were already saved are skipped via the
 * `${email_id}#${attachment.id}` UNIQUE key.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSuperUser, isAuthError } from "@/lib/api-middleware";
import { database } from "@/db";
import { franchisee, client } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import {
  fetchInboundEmail,
  downloadAttachment,
  identifyClientFromEmail,
  resolvePeriod,
} from "@/lib/email/inbound";
import { processClientDocument } from "@/lib/client-document-processor";
import { getClientParser, getInvoiceParser } from "@/lib/client-parsers";
import { matchFranchiseeName } from "@/lib/franchisee-matcher";
import { isWoltEzcountFileB } from "@/lib/client-parsers/wolt-parser";
import type { Franchisee } from "@/db/schema";

const BODY_BASED_CLIENTS = new Set(["CIBUS"]);
const INVOICE_SUBJECT_KEYWORDS = [
  "חשבונית מס",
  "חשבונית עמלה",
  "חשבונית מס/קבלה",
  "חשבונית מרכזת",
  "tax invoice",
  "commission invoice",
  "easycount invoice",
  "ezcount invoice",
  "החשבונית החודשית",
];

function detectDocumentType(
  subject: string
): "client_report" | "commission_invoice" {
  const lower = subject.toLowerCase();
  for (const keyword of INVOICE_SUBJECT_KEYWORDS) {
    if (lower.includes(keyword.toLowerCase())) {
      return "commission_invoice";
    }
  }
  return "client_report";
}

const UNKNOWN_FRANCHISEE_NAMES = new Set(["לא זוהה", ""]);

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
      const parseResult = await parser(buffer, mimeType);
      if (
        parseResult.success &&
        parseResult.data?.franchiseeName &&
        !UNKNOWN_FRANCHISEE_NAMES.has(parseResult.data.franchiseeName)
      ) {
        const match = matchFranchiseeName(
          parseResult.data.franchiseeName,
          franchisees,
          { minConfidence: 0.6 }
        );
        if (match.matchedFranchisee) {
          return {
            franchiseeId: match.matchedFranchisee.id,
            franchiseeName: match.matchedFranchisee.name,
          };
        }
      }
    } catch {
      // fall through to filename / subject fallbacks
    }
  }

  if (attachmentFilename) {
    const withoutExt = attachmentFilename.replace(/\.[^.]+$/, "");
    const candidates: string[] = [];
    const dbl = withoutExt.split("__");
    if (dbl.length > 1 && dbl[0].trim().length >= 3) candidates.push(dbl[0].trim());
    const heb = withoutExt
      .split("_")
      .filter((p) => /^[֐-׿][֐-׿ ]*$/.test(p));
    if (heb.length >= 1) candidates.push(heb.join(" ").trim());
    for (const c of candidates) {
      if (c.length < 3) continue;
      const m = matchFranchiseeName(c, franchisees, { minConfidence: 0.6 });
      if (m.matchedFranchisee) {
        return {
          franchiseeId: m.matchedFranchisee.id,
          franchiseeName: m.matchedFranchisee.name,
        };
      }
    }
  }

  const cleanedSubject = subject
    .replace(/^(fwd?|re|fw|subject):\s*/gi, "")
    .replace(/\[העתק\]\s*|\[העברה\]\s*/g, "")
    .trim();
  const parts = cleanedSubject.split(/\s*[-–—|,]\s*/);
  for (const part of parts) {
    if (part.trim().length < 3) continue;
    const m = matchFranchiseeName(part.trim(), franchisees, {
      minConfidence: 0.75,
    });
    if (m.matchedFranchisee) {
      return {
        franchiseeId: m.matchedFranchisee.id,
        franchiseeName: m.matchedFranchisee.name,
      };
    }
  }

  return null;
}

async function extractAndDownloadLinks(
  htmlBody: string
): Promise<Array<{ buffer: Buffer; fileName: string }>> {
  const out: Array<{ buffer: Buffer; fileName: string }> = [];
  const ezLinks =
    htmlBody.match(
      /https?:\/\/files\.ezcount\.co\.il\/front\/documents\/get\/[^"'\s<>]+/g
    ) || [];
  for (const u of ezLinks) {
    try {
      const res = await fetch(u.replace(/&amp;/g, "&"), { redirect: "follow" });
      if (!res.ok) continue;
      const buf = Buffer.from(await res.arrayBuffer());
      const m = u.match(/get\/([0-9a-f-]+)\//);
      out.push({ buffer: buf, fileName: m ? `ezcount-${m[1]}.pdf` : "ezcount.pdf" });
    } catch {}
  }
  if (out.length === 0) {
    const direct =
      htmlBody.match(/https?:\/\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?/gi) || [];
    const unique = [...new Set(direct.map((u) => u.replace(/&amp;/g, "&")))];
    for (const u of unique) {
      try {
        const res = await fetch(u);
        if (!res.ok) continue;
        const buf = Buffer.from(await res.arrayBuffer());
        const fileName = u.split("?")[0].split("/").pop() ?? "report.pdf";
        out.push({ buffer: buf, fileName });
      } catch {}
    }
  }
  return out;
}

interface ReplayOutcome {
  emailId: string;
  status: "ok" | "skipped" | "error";
  clientCode?: string;
  documentsCreated?: number;
  duplicatesSkipped?: number;
  error?: string;
  // Diagnostics — populated on failure paths so we can see why a replay
  // produced 0 documents without grepping Vercel logs.
  trace?: {
    rawAttachmentCount?: number;
    documentAttachmentCount?: number;
    extractedLinks?: number;
    downloadedFiles?: number;
    franchiseeResolveFailures?: string[];
    parseFailures?: string[];
    processFailures?: string[];
  };
}

export async function POST(request: NextRequest) {
  const authHeader = request.headers.get("authorization");
  const cronSecret = process.env.CRON_SECRET;
  const isCronAuthorized =
    cronSecret && authHeader && authHeader === `Bearer ${cronSecret}`;
  if (!isCronAuthorized) {
    const authResult = await requireSuperUser(request);
    if (isAuthError(authResult)) return authResult;
  }

  const body = (await request.json().catch(() => ({}))) as {
    emailIds?: string[];
  };
  const emailIds = body.emailIds ?? [];
  if (!Array.isArray(emailIds) || emailIds.length === 0) {
    return NextResponse.json(
      { error: "emailIds array required" },
      { status: 400 }
    );
  }

  const allFranchisees = (await database
    .select()
    .from(franchisee)
    .where(eq(franchisee.isActive, true))) as Franchisee[];

  const outcomes: ReplayOutcome[] = [];

  for (const emailId of emailIds) {
    const outcome: ReplayOutcome = {
      emailId,
      status: "error",
      trace: {
        franchiseeResolveFailures: [],
        parseFailures: [],
        processFailures: [],
      },
    };
    const trace = outcome.trace!;
    try {
      const email = await fetchInboundEmail(emailId);
      if (!email) {
        outcome.error = "Failed to fetch email from Resend";
        outcomes.push(outcome);
        continue;
      }

      const identifiedClient = await identifyClientFromEmail(
        email.to,
        email.from,
        email.subject
      );
      if (!identifiedClient) {
        outcome.error = `Client not identified for from=${email.from} to=${email.to.join(",")}`;
        outcomes.push(outcome);
        continue;
      }
      outcome.clientCode = identifiedClient.clientCode;

      const period = resolvePeriod(email.subject, email.createdAt);
      const documentType = detectDocumentType(email.subject);

      let documentsCreated = 0;
      let duplicatesSkipped = 0;

      // TENBIS sends monthly reports inline in the email HTML body (no
      // attachments, no download links) — mirror the body-based path in
      // src/app/api/clients/email-inbound/route.ts so replay can recover them
      // (e.g. the 7 April-2026 reports that failed before that path existed).
      const tenbisInlineHtmlReport =
        identifiedClient.clientCode.toUpperCase() === "TENBIS" &&
        documentType === "client_report" &&
        email.attachments.length === 0 &&
        /למסעדת|פירוט\s+עסקאות|תן\s+ביס/.test(email.html || email.text || "");

      const isBodyBased =
        (BODY_BASED_CLIENTS.has(identifiedClient.clientCode.toUpperCase()) &&
          documentType !== "commission_invoice") ||
        tenbisInlineHtmlReport;

      if (isBodyBased) {
        const content = email.html || email.text;
        if (content) {
          const buf = Buffer.from(content, "utf-8");
          const mime = email.html ? "text/html" : "text/plain";
          const fr = await resolveFranchisee(
            buf,
            mime,
            identifiedClient.parserCode,
            email.subject,
            allFranchisees,
            undefined,
            documentType
          );
          if (fr) {
            const r = await processClientDocument({
              buffer: buf,
              fileName: `email-${emailId}.${email.html ? "html" : "txt"}`,
              mimeType: mime,
              clientId: identifiedClient.clientId,
              parserCode: identifiedClient.parserCode,
              franchiseeId: fr.franchiseeId,
              periodMonth: period.month,
              periodYear: period.year,
              documentType,
              source: "gmail_fetch",
              gmailMessageId: emailId,
            });
            if (r.skippedDuplicate) duplicatesSkipped++;
            else if (r.success) documentsCreated++;
          }
        }
      } else {
        const docAtts = email.attachments.filter(
          (a) =>
            a.contentType === "application/pdf" ||
            a.contentType ===
              "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
            a.contentType === "application/vnd.ms-excel" ||
            a.filename.endsWith(".pdf") ||
            a.filename.endsWith(".xlsx") ||
            a.filename.endsWith(".xls")
        );

        trace.rawAttachmentCount = email.attachments.length;
        trace.documentAttachmentCount = docAtts.length;

        if (docAtts.length === 0) {
          const html = email.html || email.text || "";
          const linkCount =
            (html.match(
              /https?:\/\/files\.ezcount\.co\.il\/front\/documents\/get\/[^"'\s<>]+/g
            ) || []).length +
            (html.match(/https?:\/\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?/gi) || []).length;
          trace.extractedLinks = linkCount;

          const downloaded = await extractAndDownloadLinks(html);
          trace.downloadedFiles = downloaded.length;

          for (let i = 0; i < downloaded.length; i++) {
            const f = downloaded[i];
            const fr = await resolveFranchisee(
              f.buffer,
              "application/pdf",
              identifiedClient.parserCode,
              email.subject,
              allFranchisees,
              f.fileName,
              documentType
            );
            if (!fr) {
              trace.franchiseeResolveFailures!.push(f.fileName);
              continue;
            }
            const r = await processClientDocument({
              buffer: f.buffer,
              fileName: f.fileName,
              mimeType: "application/pdf",
              clientId: identifiedClient.clientId,
              parserCode: identifiedClient.parserCode,
              franchiseeId: fr.franchiseeId,
              periodMonth: period.month,
              periodYear: period.year,
              documentType,
              source: "gmail_fetch",
              gmailMessageId: `${emailId}#dl${i}`,
            });
            if (r.skippedDuplicate) duplicatesSkipped++;
            else if (r.success) documentsCreated++;
            else
              trace.processFailures!.push(
                `${f.fileName}: ${r.error ?? "unknown"}`
              );
          }
        } else {
          // Wolt File A/B selector for attachment-based emails (mirror of
          // route.ts filterAttachments).
          let attsToProcess: Array<{
            id: string;
            filename: string;
            contentType: string;
            buffer: Buffer;
            documentType: "client_report" | "commission_invoice";
          }> = [];

          if (identifiedClient.clientCode === "WOLT") {
            const ezcountCandidates = docAtts.filter((a) => {
              if (a.contentType !== "application/pdf") return false;
              const lower = a.filename.toLowerCase();
              if (/sales_report|netting|commission/.test(lower)) return false;
              return /^[֐-׿][֐-׿ ]*_(?!_)/.test(a.filename);
            });
            let fileA: typeof ezcountCandidates[number] | null = null;
            let fileB: typeof ezcountCandidates[number] | null = null;
            const buffers = new Map<string, Buffer>();
            for (const c of ezcountCandidates) {
              const buf = await downloadAttachment(c.downloadUrl);
              if (!buf) continue;
              buffers.set(c.id, buf);
              const isB = await isWoltEzcountFileB(buf);
              if (isB && !fileB) fileB = c;
              else if (!isB && !fileA) fileA = c;
              if (fileA && fileB) break;
            }
            if (fileA && buffers.has(fileA.id)) {
              attsToProcess.push({
                id: fileA.id,
                filename: fileA.filename,
                contentType: fileA.contentType,
                buffer: buffers.get(fileA.id)!,
                documentType: "commission_invoice",
              });
            }
            if (fileB && buffers.has(fileB.id)) {
              attsToProcess.push({
                id: fileB.id,
                filename: fileB.filename,
                contentType: fileB.contentType,
                buffer: buffers.get(fileB.id)!,
                documentType: "client_report",
              });
            }
          } else {
            for (const a of docAtts) {
              const buf = await downloadAttachment(a.downloadUrl);
              if (!buf) continue;
              attsToProcess.push({
                id: a.id,
                filename: a.filename,
                contentType: a.contentType,
                buffer: buf,
                documentType,
              });
            }
          }

          for (const a of attsToProcess) {
            const fr = await resolveFranchisee(
              a.buffer,
              a.contentType,
              identifiedClient.parserCode,
              email.subject,
              allFranchisees,
              a.filename,
              a.documentType
            );
            if (!fr) continue;
            const r = await processClientDocument({
              buffer: a.buffer,
              fileName: a.filename,
              mimeType: a.contentType,
              clientId: identifiedClient.clientId,
              parserCode: identifiedClient.parserCode,
              franchiseeId: fr.franchiseeId,
              periodMonth: period.month,
              periodYear: period.year,
              documentType: a.documentType,
              source: "gmail_fetch",
              gmailMessageId: `${emailId}#${a.id}`,
            });
            if (r.skippedDuplicate) duplicatesSkipped++;
            else if (r.success) documentsCreated++;
          }
        }
      }

      outcome.documentsCreated = documentsCreated;
      outcome.duplicatesSkipped = duplicatesSkipped;
      outcome.status =
        documentsCreated > 0 ? "ok" : duplicatesSkipped > 0 ? "skipped" : "error";
      if (outcome.status === "error" && !outcome.error) {
        outcome.error = "no documents created and no duplicates skipped";
      }
    } catch (err) {
      outcome.error = err instanceof Error ? err.message : String(err);
    }

    outcomes.push(outcome);
  }

  return NextResponse.json({ success: true, outcomes });
}
