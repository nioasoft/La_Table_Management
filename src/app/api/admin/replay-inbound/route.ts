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
 * Parity: classification (`detectDocumentType`), franchisee resolution
 * (`resolveFranchisee`, incl. parent-brand override + strict acceptance gate
 * + inactive-branch skip) and link download (`extractAndDownloadLinks`, incl.
 * the SSRF guard) all import the SAME shared modules as the live webhook, so a
 * replay routes an email exactly as production would. Do NOT re-fork these.
 *
 * Idempotent: documents that were already saved are skipped via the
 * `${email_id}#${attachment.id}` UNIQUE key.
 */

import { NextRequest, NextResponse } from "next/server";
import { requireSuperUser, isAuthError } from "@/lib/api-middleware";
import { database } from "@/db";
import { franchisee } from "@/db/schema";
import { eq } from "drizzle-orm";
import {
  fetchInboundEmail,
  downloadAttachment,
  identifyClientFromEmail,
  resolvePeriod,
} from "@/lib/email/inbound";
import { processClientDocument } from "@/lib/client-document-processor";
import { isWoltEzcountFileB } from "@/lib/client-parsers/wolt-parser";
import { isRfc822Attachment, unwrapRfc822 } from "@/lib/email/unwrap-rfc822";
import { detectDocumentType } from "@/lib/email/classify-document-type";
import {
  resolveFranchisee,
  isInactiveFranchiseeSkip,
} from "@/lib/email/resolve-franchisee";
import { extractAndDownloadLinks } from "@/lib/email/download-links";
import type { Franchisee } from "@/db/schema";

const BODY_BASED_CLIENTS = new Set(["CIBUS"]);

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
    // message/rfc822 ("forward as attachment") diagnostics.
    rfc822Count?: number;
    rfc822Extracted?: number;
    rfc822InnerSubjects?: string[];
    rfc822InnerLinks?: string[];
    rfc822Errors?: string[];
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

  const activeFranchisees = (await database
    .select()
    .from(franchisee)
    .where(eq(franchisee.isActive, true))) as Franchisee[];
  // Inactive list feeds the shared resolver's silent-skip path so a replay
  // of a closed-branch email (e.g. Pluxee → קינג קונג מוצקין) is skipped, not
  // misassigned — same as the live webhook.
  const inactiveFranchisees = (await database
    .select()
    .from(franchisee)
    .where(eq(franchisee.isActive, false))) as Franchisee[];

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
    let documentsCreated = 0;
    let duplicatesSkipped = 0;

    // Resolve the franchisee via the shared resolver and return the id, or
    // null when the file should be skipped (inactive branch) or has no
    // acceptable match. Records the reason into the trace.
    const resolveOrTrace = async (
      buffer: Buffer,
      mimeType: string,
      parserCode: string,
      subject: string,
      attachmentFilename: string | undefined,
      documentType: "client_report" | "commission_invoice",
      label: string,
    ): Promise<string | null> => {
      const fr = await resolveFranchisee(
        buffer,
        mimeType,
        parserCode,
        subject,
        activeFranchisees,
        attachmentFilename,
        documentType,
        inactiveFranchisees,
      );
      if (fr.ok) return fr.franchiseeId;
      if (isInactiveFranchiseeSkip(fr)) {
        duplicatesSkipped++;
        trace.franchiseeResolveFailures!.push(
          `${label}: skipped inactive franchisee "${fr.inactiveFranchiseeName}"`,
        );
        return null;
      }
      trace.franchiseeResolveFailures!.push(label);
      return null;
    };

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
      const documentType = detectDocumentType(
        email.subject,
        email.text || email.html || undefined,
      );

      // TENBIS inline monthly report — body carries "פירוט עסקאות למסעדת".
      // Mirror the main route: the month-end *cover* email (report behind a
      // Mandrill→cdn.10bis.co.il PDF link) must NOT match here, so it falls to
      // the link-download path below. See email-inbound/route.ts for context.
      const tenbisInlineHtmlReport =
        identifiedClient.clientCode.toUpperCase() === "TENBIS" &&
        documentType === "client_report" &&
        email.attachments.length === 0 &&
        /פירוט\s+עסקאות\s+למסעדת/.test(email.html || email.text || "");

      const isBodyBased =
        (BODY_BASED_CLIENTS.has(identifiedClient.clientCode.toUpperCase()) &&
          documentType !== "commission_invoice") ||
        tenbisInlineHtmlReport;

      if (isBodyBased) {
        const content = email.html || email.text;
        if (content) {
          const buf = Buffer.from(content, "utf-8");
          const mime = email.html ? "text/html" : "text/plain";
          const franchiseeId = await resolveOrTrace(
            buf,
            mime,
            identifiedClient.parserCode,
            email.subject,
            undefined,
            documentType,
            `email-${emailId} body`,
          );
          if (franchiseeId) {
            const r = await processClientDocument({
              buffer: buf,
              fileName: `email-${emailId}.${email.html ? "html" : "txt"}`,
              mimeType: mime,
              clientId: identifiedClient.clientId,
              parserCode: identifiedClient.parserCode,
              franchiseeId,
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
        // Unwrap "Forward as attachment" emails (message/rfc822) first —
        // mirrors email-inbound/route.ts. Each wrapped .eml yields inner
        // PDF/Excel documents and/or an inner body with download links,
        // classified by the INNER subject (the outer forward may be blank).
        const rfc822Atts = email.attachments.filter(isRfc822Attachment);
        const directAtts = email.attachments.filter(
          (a) => !isRfc822Attachment(a),
        );
        trace.rfc822Count = rfc822Atts.length;
        trace.rfc822Extracted = 0;
        trace.rfc822InnerSubjects = [];
        trace.rfc822InnerLinks = [];
        trace.rfc822Errors = [];

        for (let e = 0; e < rfc822Atts.length; e++) {
          const emlBuffer = await downloadAttachment(rfc822Atts[e].downloadUrl);
          if (!emlBuffer) {
            trace.rfc822Errors!.push(`${rfc822Atts[e].filename}: download failed`);
            continue;
          }
          let innerType: "client_report" | "commission_invoice" = documentType;
          let extracted: Array<{ buffer: Buffer; fileName: string }> = [];
          let innerBody = "";
          try {
            const unwrapped = await unwrapRfc822(emlBuffer);
            innerType = detectDocumentType(
              unwrapped.subject,
              unwrapped.html || unwrapped.text || undefined,
            );
            extracted = unwrapped.pdfFiles;
            innerBody = `${unwrapped.html}\n${unwrapped.text}`;
            trace.rfc822Extracted! += extracted.length;
            trace.rfc822InnerSubjects!.push(unwrapped.subject || "(blank)");
            // Capture all https links in the inner body so we can see what the
            // download path missed (e.g. invoice-one.com viewer URLs).
            const links = innerBody.match(/https?:\/\/[^\s"'<>]+/gi) || [];
            for (const l of links.slice(0, 6)) trace.rfc822InnerLinks!.push(l);
          } catch (err) {
            trace.rfc822Errors!.push(
              `${rfc822Atts[e].filename}: ${err instanceof Error ? err.message : String(err)}`,
            );
            continue;
          }

          // Inner PDF/Excel documents.
          for (let j = 0; j < extracted.length; j++) {
            const f = extracted[j];
            const franchiseeId = await resolveOrTrace(
              f.buffer,
              "application/pdf",
              identifiedClient.parserCode,
              email.subject,
              f.fileName,
              innerType,
              f.fileName,
            );
            if (!franchiseeId) continue;
            const r = await processClientDocument({
              buffer: f.buffer,
              fileName: f.fileName,
              mimeType: "application/pdf",
              clientId: identifiedClient.clientId,
              parserCode: identifiedClient.parserCode,
              franchiseeId,
              periodMonth: period.month,
              periodYear: period.year,
              documentType: innerType,
              source: "gmail_fetch",
              gmailMessageId: `${emailId}#eml${e}_${j}`,
            });
            if (r.skippedDuplicate) duplicatesSkipped++;
            else if (r.success) documentsCreated++;
            else
              trace.processFailures!.push(
                `${f.fileName}: ${r.error ?? "unknown"}`,
              );
          }

          // Inner body download links (link-based invoices).
          if (innerBody.trim()) {
            const downloaded = await extractAndDownloadLinks(
              innerBody,
              identifiedClient.clientCode,
            );
            for (let i = 0; i < downloaded.length; i++) {
              const f = downloaded[i];
              const franchiseeId = await resolveOrTrace(
                f.buffer,
                "application/pdf",
                identifiedClient.parserCode,
                email.subject,
                f.fileName,
                innerType,
                f.fileName,
              );
              if (!franchiseeId) continue;
              const r = await processClientDocument({
                buffer: f.buffer,
                fileName: f.fileName,
                mimeType: "application/pdf",
                clientId: identifiedClient.clientId,
                parserCode: identifiedClient.parserCode,
                franchiseeId,
                periodMonth: period.month,
                periodYear: period.year,
                documentType: innerType,
                source: "gmail_fetch",
                gmailMessageId: `${emailId}#emldl${e}_${i}`,
              });
              if (r.skippedDuplicate) duplicatesSkipped++;
              else if (r.success) documentsCreated++;
              else
                trace.processFailures!.push(
                  `${f.fileName}: ${r.error ?? "unknown"}`,
                );
            }
          }
        }

        const docAtts = directAtts.filter(
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

          const downloaded = await extractAndDownloadLinks(
            html,
            identifiedClient.clientCode,
          );
          trace.downloadedFiles = downloaded.length;

          for (let i = 0; i < downloaded.length; i++) {
            const f = downloaded[i];
            const franchiseeId = await resolveOrTrace(
              f.buffer,
              "application/pdf",
              identifiedClient.parserCode,
              email.subject,
              f.fileName,
              documentType,
              f.fileName,
            );
            if (!franchiseeId) continue;
            const r = await processClientDocument({
              buffer: f.buffer,
              fileName: f.fileName,
              mimeType: "application/pdf",
              clientId: identifiedClient.clientId,
              parserCode: identifiedClient.parserCode,
              franchiseeId,
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
          const attsToProcess: Array<{
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
            const franchiseeId = await resolveOrTrace(
              a.buffer,
              a.contentType,
              identifiedClient.parserCode,
              email.subject,
              a.filename,
              a.documentType,
              a.filename,
            );
            if (!franchiseeId) continue;
            const r = await processClientDocument({
              buffer: a.buffer,
              fileName: a.filename,
              mimeType: a.contentType,
              clientId: identifiedClient.clientId,
              parserCode: identifiedClient.parserCode,
              franchiseeId,
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
