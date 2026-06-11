/**
 * POST /api/clients/email-inbound — Resend Inbound webhook
 *
 * Receives email.received events from Resend Inbound.
 * Flow:
 * 1. Verify webhook signature
 * 2. Identify client from to/from/subject
 * 3. Fetch full email via Resend API
 * 4. Route: body-based (Cibus) or attachment-based (Tenbis/Wolt/Hever)
 * 5. Process through processClientDocument()
 * 6. Log to gmail_sync_log
 *
 * IMPORTANT: Always returns 200 to prevent Resend retries, even on errors.
 */

import { NextRequest, NextResponse } from "next/server";
import { Resend } from "resend";
import {
  fetchInboundEmail,
  downloadAttachment,
  identifyClientFromEmail,
  resolvePeriod,
  type ResendInboundWebhookPayload,
} from "@/lib/email/inbound";
import { processClientDocument } from "@/lib/client-document-processor";
import { getClientParser, getInvoiceParser } from "@/lib/client-parsers";
import {
  createSyncLogEntry,
  updateSyncLogEntry,
} from "@/data-access/gmail-sync";
import { createInboundReviewEntry } from "@/data-access/inbound-review-queue";
import { uploadDocument } from "@/lib/storage";
import type { InboundReviewStatus } from "@/db/schema";
import type { ProcessClientDocumentResult } from "@/lib/client-document-processor";
import { matchFranchiseeName } from "@/lib/franchisee-matcher";
import {
  decideFranchiseeAcceptance,
  formatVerdictForLog,
  type AcceptanceVerdict,
} from "@/lib/franchisee-match-acceptance";
import {
  classifyWoltEzcountAttachment,
  isWoltEzcountFileB,
} from "@/lib/client-parsers/wolt-parser";
import {
  detectDocumentType,
  isPromotionalSubject,
  isCibusDailyReport,
  isHaatMonthlyReport,
} from "@/lib/email/classify-document-type";
import { findOperatingBrand } from "@/lib/franchisee-parent-map";
import { database } from "@/db";
import { franchisee } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { Franchisee } from "@/db/schema";

/** Client codes that parse from email body instead of attachments */
const BODY_BASED_CLIENTS = new Set(["CIBUS"]);

// Subject classifier (`detectDocumentType`) lives in
// `@/lib/email/classify-document-type` so the offline reprocess script
// (`scripts/reprocess-inbound-email.ts`) can share the same rules.

export async function POST(request: NextRequest) {
  // Create sync log early
  const syncLog = await createSyncLogEntry();
  let messagesScanned = 0;
  let documentsCreated = 0;
  let duplicatesSkipped = 0;
  let errorCount = 0;
  const errorDetails: string[] = [];

  // Diagnostics captured on every webhook invocation. Always written to
  // gmail_sync_log so production failures (e.g. "no attachments") can be
  // investigated without forwarding the original email or chasing Vercel
  // console logs.
  const diagnostics: {
    emailId: string | null;
    fromAddress: string | null;
    toAddresses: string[] | null;
    subject: string | null;
    clientCode: string | null;
    identifiedBy: string | null;
    rawAttachments: Array<{ filename: string; contentType: string; size: number }> | null;
    rawAttachmentCount: number | null;
    filteredAttachmentCount: number | null;
    bodyExcerpt: string | null;
  } = {
    emailId: null,
    fromAddress: null,
    toAddresses: null,
    subject: null,
    clientCode: null,
    identifiedBy: null,
    rawAttachments: null,
    rawAttachmentCount: null,
    filteredAttachmentCount: null,
    bodyExcerpt: null,
  };

  try {
    // ─── Step 1: Verify webhook signature ──────────────────────────────
    const body = await request.text();
    const webhookSecret = process.env.RESEND_INBOUND_WEBHOOK_SECRET;

    // Verify webhook signature — fail hard if secret is not configured
    if (!webhookSecret) {
      console.error("[email-inbound] RESEND_INBOUND_WEBHOOK_SECRET is not configured");
      await finalizeSyncLog(syncLog.id, "failed", {
        messagesScanned: 0,
        documentsCreated: 0,
        duplicatesSkipped: 0,
        errorCount: 1,
        errorDetails: ["Webhook secret not configured"],
      });
      return NextResponse.json(
        { error: "Webhook not configured" },
        { status: 503 }
      );
    }

    const svixId = request.headers.get("svix-id");
    const svixTimestamp = request.headers.get("svix-timestamp");
    const svixSignature = request.headers.get("svix-signature");

    if (!svixId || !svixTimestamp || !svixSignature) {
      await finalizeSyncLog(syncLog.id, "failed", {
        messagesScanned,
        documentsCreated,
        duplicatesSkipped,
        errorCount: 1,
        errorDetails: ["Missing svix headers"],
      });
      return NextResponse.json(
        { error: "Missing signature headers" },
        { status: 401 }
      );
    }

    try {
      const resend = new Resend(process.env.RESEND_API_KEY);
      resend.webhooks.verify({
        payload: body,
        headers: {
          id: svixId,
          timestamp: svixTimestamp,
          signature: svixSignature,
        },
        webhookSecret,
      });
    } catch (verifyError) {
      console.error("[email-inbound] Signature verification failed:", verifyError);
      await finalizeSyncLog(syncLog.id, "failed", {
        messagesScanned,
        documentsCreated,
        duplicatesSkipped,
        errorCount: 1,
        errorDetails: ["Invalid webhook signature"],
      });
      return NextResponse.json(
        { error: "Invalid signature" },
        { status: 401 }
      );
    }

    // ─── Step 2: Parse webhook event ───────────────────────────────────
    const event = JSON.parse(body) as ResendInboundWebhookPayload;

    if (event.type !== "email.received") {
      // Not an inbound email event — ignore silently
      await finalizeSyncLog(syncLog.id, "completed", {
        messagesScanned: 0,
        documentsCreated: 0,
        duplicatesSkipped: 0,
        errorCount: 0,
      });
      return NextResponse.json({ received: true, skipped: true });
    }

    const { email_id, from, to, subject } = event.data;
    messagesScanned = 1;

    // Capture into diagnostics immediately — anything that fails after this
    // point will still have from/to/subject/email_id stored in gmail_sync_log.
    diagnostics.emailId = email_id;
    diagnostics.fromAddress = from;
    diagnostics.toAddresses = to;
    diagnostics.subject = subject;

    console.log(
      `[email-inbound] Received email from ${from} to ${to.join(",")} subject: "${subject}"`
    );

    // ─── Step 2a: Auto-skip promotional / non-data emails ──────────────
    // Wolt Benefits announcements, Cibus "הסכם התקשרות", etc. have nothing
    // to extract and used to clog the daily failure digest. Treated as a
    // silent skip: log row stays for auditability, but status=completed and
    // no errors so downstream alerting ignores it.
    if (isPromotionalSubject(subject)) {
      console.log(
        `[email-inbound] Skipping promotional email: "${subject}"`
      );
      await finalizeSyncLog(syncLog.id, "completed", {
        messagesScanned: 1,
        documentsCreated: 0,
        duplicatesSkipped: 1,
        errorCount: 0,
        errorDetails: [`דולג: מייל שיווקי / לא-נתונים (${subject})`],
        ...diagnostics,
      });
      return NextResponse.json({
        received: true,
        skipped: true,
        reason: "promotional",
      });
    }

    // ─── Step 2b: Backup forward to Hadas ──────────────────────────────
    // Every inbound email is forwarded to Hadas as a safety net so nothing
    // can be silently dropped by parser/extractor gaps. Resend SDK v6 does
    // not expose emails.receiving.forward (newer API), so we replicate it
    // manually: fetch raw email + attachments, then resend via emails.send.
    // Failures here MUST NOT block the rest of the pipeline — we log and
    // continue.
    try {
      const fwdEmail = await fetchInboundEmail(email_id);
      if (fwdEmail) {
        const fwdAttachments = await Promise.all(
          fwdEmail.attachments.map(async (a) => {
            const buf = await downloadAttachment(a.downloadUrl);
            if (!buf) return null;
            return {
              filename: a.filename,
              content: buf.toString("base64"),
            };
          })
        );
        const cleanAttachments = fwdAttachments.filter(
          (a): a is { filename: string; content: string } => a !== null
        );

        const html =
          fwdEmail.html ||
          (fwdEmail.text
            ? `<pre>${fwdEmail.text}</pre>`
            : "<p>(no body)</p>");

        const resendForward = new Resend(process.env.RESEND_API_KEY);
        const { error: forwardError } = await resendForward.emails.send({
          from: process.env.EMAIL_FROM || "noreply@latable.co.il",
          to: ["Hadas@latableg.com"],
          subject: `[Backup] ${fwdEmail.subject || "(no subject)"}`,
          html,
          attachments:
            cleanAttachments.length > 0 ? cleanAttachments : undefined,
        });
        if (forwardError) {
          console.warn(
            `[email-inbound] Backup forward to Hadas failed for ${email_id}:`,
            forwardError
          );
        } else {
          console.log(
            `[email-inbound] Backup-forwarded ${email_id} to Hadas (${cleanAttachments.length} attachment(s))`
          );
        }
      }
    } catch (err) {
      console.warn(
        `[email-inbound] Backup forward threw for ${email_id}:`,
        err
      );
    }

    // ─── Step 3: Identify client ───────────────────────────────────────
    const identifiedClient = await identifyClientFromEmail(to, from, subject);

    if (!identifiedClient) {
      const msg = `לא זוהה לקוח עבור מייל מ-${from} ל-${to.join(",")}`;
      console.warn(`[email-inbound] ${msg}`);
      errorCount++;
      errorDetails.push(msg);

      await finalizeSyncLog(syncLog.id, "failed", {
        messagesScanned,
        documentsCreated,
        duplicatesSkipped,
        errorCount,
        errorDetails,
        ...diagnostics,
      });
      return NextResponse.json({ received: true, error: msg });
    }

    diagnostics.clientCode = identifiedClient.clientCode;
    diagnostics.identifiedBy = identifiedClient.identifiedBy;

    console.log(
      `[email-inbound] Identified client: ${identifiedClient.clientCode} (by ${identifiedClient.identifiedBy})`
    );

    // ─── Step 3b: Drop Cibus daily snapshots ───────────────────────────
    // Pluxee sends a DAILY "Pluxee דוח" (single-day period) in addition to
    // the authoritative month-end "ריכוז חיוב חודשי" report. The daily
    // snapshot overwrites the franchisee+month document with single-day
    // (usually zero) figures and corrupts the monthly total — it zeroed the
    // entire May 2026 Cibus dataset. Per Reut (2026-06-02) the daily
    // snapshots have no business use, so we drop them silently here. The
    // month-end report is matched by a different subject and is unaffected.
    if (isCibusDailyReport(identifiedClient.clientCode, subject)) {
      console.log(
        `[email-inbound] Skipping Cibus daily snapshot: "${subject}"`
      );
      await finalizeSyncLog(syncLog.id, "completed", {
        messagesScanned: 1,
        documentsCreated: 0,
        duplicatesSkipped: 1,
        errorCount: 0,
        errorDetails: [
          `דולג: דוח יומי של פלאקסי (${subject}) — נקלט רק הריכוז החודשי`,
        ],
        ...diagnostics,
      });
      return NextResponse.json({
        received: true,
        skipped: true,
        reason: "cibus_daily_snapshot",
      });
    }

    // ─── Step 3c: Drop HAAT monthly summary ("דווח האאט" red PDF) ──────
    // Per Reut (2026-06-11) the red monthly summary is not used in
    // reconciliation — the HAAT "report" she reconciles is the franchisee-
    // issued EasyCount invoice. Ingesting the red PDF also corrupted data:
    // two HAAT businesses (8093 VINNI / 8095 Natanzon Burger) share one
    // legal entity, both resolved to פט ויני עזריאלי, and the second
    // overwrote the first in the client_report slot. Drop on arrival.
    if (isHaatMonthlyReport(identifiedClient.clientCode, subject)) {
      console.log(
        `[email-inbound] Skipping HAAT monthly summary (red report): "${subject}"`
      );
      await finalizeSyncLog(syncLog.id, "completed", {
        messagesScanned: 1,
        documentsCreated: 0,
        duplicatesSkipped: 1,
        errorCount: 0,
        errorDetails: [
          `דולג: דוח חודשי מסכם של HAAT ("${subject}") — הדוח שנקלט הוא חשבונית ה-EasyCount של הזכיין`,
        ],
        ...diagnostics,
      });
      return NextResponse.json({
        received: true,
        skipped: true,
        reason: "haat_monthly_summary",
      });
    }

    // ─── Step 4: Fetch full email from Resend ──────────────────────────
    const email = await fetchInboundEmail(email_id);

    if (!email) {
      const msg = `לא ניתן לשלוף מייל ${email_id} מ-Resend`;
      errorCount++;
      errorDetails.push(msg);

      await finalizeSyncLog(syncLog.id, "failed", {
        messagesScanned,
        documentsCreated,
        duplicatesSkipped,
        errorCount,
        errorDetails,
        ...diagnostics,
      });
      return NextResponse.json({ received: true, error: msg });
    }

    // Capture diagnostics from every inbound email — not just on the
    // "no attachments" failure path. Without this the May 2026 outage
    // accumulated 30+ failed gmail_sync_log rows where we couldn't see
    // what the email body actually looked like, and had to re-fetch
    // each one via the Resend API to diagnose. Now `body_excerpt` and
    // `raw_attachments` are always present, so the Cron Monitor admin
    // tab is enough to spot a vendor format change same-day.
    {
      const body = email.html || email.text || "";
      if (body) {
        diagnostics.bodyExcerpt = body.length > 8000 ? body.slice(0, 8000) : body;
      }
      diagnostics.rawAttachmentCount = email.attachments.length;
      diagnostics.rawAttachments = email.attachments.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
      }));
    }

    // ─── Step 5: Resolve period ────────────────────────────────────────
    const period = resolvePeriod(subject, email.createdAt);

    // ─── Step 5b: Detect document type from subject (+ body fallback) ─
    // Body fallback handles ambiguous subjects like "FW: invoice" where
    // the actual income-vs-commission distinction only appears in the
    // email body. Required to prevent the 2026-05-10 misclassification of
    // a Hatt-Netanzon income invoice as a Vini-Azrieli commission invoice.
    const documentType = detectDocumentType(
      subject,
      email.text || email.html || undefined,
    );
    if (documentType === "commission_invoice") {
      console.log(`[email-inbound] Detected commission invoice from subject: "${subject}"`);
    }

    // ─── Step 6: Load franchisees for matching ─────────────────────────
    // We load active + inactive separately. Active is used for the live
    // matching strategies; inactive is consulted as a final "is this for a
    // closed branch?" pass so we can silent-skip those (e.g. Pluxee still
    // reporting on קינג קונג מוצקין long after the branch was closed).
    const allFranchisees = await database
      .select()
      .from(franchisee)
      .where(eq(franchisee.isActive, true));
    const inactiveFranchisees = await database
      .select()
      .from(franchisee)
      .where(eq(franchisee.isActive, false));

    // ─── Step 7: Process — body-based or attachment-based ──────────────
    // BODY_BASED_CLIENTS only applies to client_report emails. Commission
    // invoices always arrive as PDF attachments (e.g. Cibus "חשבונית מס מרכזת
    // SI...") regardless of how the client normally sends reports — so we
    // force the attachment-based path when the subject identifies the email
    // as a commission invoice.
    //
    // TENBIS sub-rule: as of 2026-05-05, 10bis sends monthly reports
    // ("דו''ח חודשי למסעדה" from service@10bis.co.il) directly in the
    // email HTML body — no attachments, no Mandrill/cdn.10bis links.
    // When that shape is detected we must take the body-based path even
    // though TENBIS is not in BODY_BASED_CLIENTS. Forwarded variants
    // ("FW: דוח חודשי מתן ביס לויני רגבה ...") still arrive with PDFs
    // attached and continue through the attachment-based path.
    // Match ONLY the true inline report — its body carries the transaction
    // detail header "פירוט עסקאות למסעדת <name>". The month-end *cover* email
    // (no-reply@10bis, subject "דוח חודשי מתן ביס ל<name>") also mentions
    // "תן ביס" but keeps the actual report behind a Mandrill→cdn.10bis.co.il
    // PDF link — it must fall through to the link-download path
    // (extractAndDownloadLinks Pattern 1), not be parsed inline as a zero-row
    // "no activity" report. A loose /תן ביס/ here misrouted every May 2026
    // cover email to ₪0 (fixed 2026-06-04).
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
      // ── Body-based client (Cibus) ──
      const emailContent = email.html || email.text;
      if (!emailContent) {
        const msg = `מייל ${email_id} ריק — אין גוף`;
        errorCount++;
        errorDetails.push(msg);
      } else {
        const buffer = Buffer.from(emailContent, "utf-8");
        const mimeType = email.html ? "text/html" : "text/plain";

        // Resolve franchisee: parse document first, fall back to subject
        const franchiseeMatch = await resolveFranchisee(
          buffer,
          mimeType,
          identifiedClient.parserCode,
          subject,
          allFranchisees as Franchisee[],
          undefined,
          documentType,
          inactiveFranchisees as Franchisee[],
        );

        // Inactive-franchisee skip: drop silently — do NOT log a failure,
        // do NOT create an inbox row. The branch is closed; the vendor is
        // still sending reports for it.
        if (isInactiveFranchiseeSkip(franchiseeMatch)) {
          duplicatesSkipped++;
          errorDetails.push(
            `דולג: מייל לזכיין סגור "${franchiseeMatch.inactiveFranchiseeName}" (confidence ${franchiseeMatch.confidence.toFixed(2)})`,
          );
          await finalizeSyncLog(syncLog.id, "completed", {
            messagesScanned,
            documentsCreated,
            duplicatesSkipped,
            errorCount: 0,
            errorDetails,
            ...diagnostics,
          });
          return NextResponse.json({
            received: true,
            skipped: true,
            reason: "inactive_franchisee",
          });
        }

        let bodyResult: ProcessClientDocumentResult | null = null;
        if (!franchiseeMatch.ok) {
          errorCount++;
          errorDetails.push(formatResolveFailure(franchiseeMatch, subject));
        } else {
          bodyResult = await processClientDocument({
            buffer,
            fileName: `email-${email_id}.${email.html ? "html" : "txt"}`,
            mimeType,
            clientId: identifiedClient.clientId,
            parserCode: identifiedClient.parserCode,
            franchiseeId: franchiseeMatch.franchiseeId,
            periodMonth: period.month,
            periodYear: period.year,
            documentType,
            source: "gmail_fetch",
            // Body-based emails have a single virtual "attachment" (the body),
            // so the email_id is sufficient and unique on its own.
            gmailMessageId: email_id,
          });

          if (bodyResult.skippedDuplicate) {
            duplicatesSkipped++;
          } else if (bodyResult.success) {
            documentsCreated++;
          } else {
            errorCount++;
            errorDetails.push(bodyResult.error ?? "שגיאה בעיבוד");
          }
        }

        await recordInboundReviewOutcome({
          syncLogId: syncLog.id,
          emailId: email_id,
          emailSubject: subject,
          emailFrom: from,
          emailReceivedAt: email.createdAt ? new Date(email.createdAt) : null,
          clientId: identifiedClient.clientId,
          clientCode: identifiedClient.clientCode,
          documentType,
          franchiseeMatch,
          processResult: bodyResult,
          // Body-based: skip pre-upload — body is already in
          // gmail_sync_log.body_excerpt and re-running the parser on a
          // saved body adds no recoverability the admin doesn't already
          // have.
          fileContext: null,
          periodMonth: period.month,
          periodYear: period.year,
        });
      }
    } else {
      // ── Attachment-based client ──
      // raw_attachment_count + raw_attachments + body_excerpt are populated
      // earlier, right after fetchInboundEmail succeeds.

      // Log ALL raw attachments so we can diagnose filter/selection issues.
      console.log(
        `[email-inbound] ${identifiedClient.clientCode}: ${email.attachments.length} raw attachments: ${email.attachments
          .map((a) => `"${a.filename}" (${a.contentType})`)
          .join(", ")}`
      );

      // Filter to PDF/Excel attachments only — skip inline images (logo, icons)
      const documentAttachments = email.attachments.filter(
        (a) =>
          a.contentType === "application/pdf" ||
          a.contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
          a.contentType === "application/vnd.ms-excel" ||
          a.filename.endsWith(".pdf") ||
          a.filename.endsWith(".xlsx") ||
          a.filename.endsWith(".xls")
      );

      diagnostics.filteredAttachmentCount = documentAttachments.length;

      // If no document attachments, try to extract download links from email body
      if (documentAttachments.length === 0) {
        const downloadedFiles = await extractAndDownloadLinks(
          email.html || email.text || "",
          identifiedClient.clientCode
        );

        if (downloadedFiles.length === 0) {
          const msg = `מייל ${email_id} ללא קבצים מצורפים ולא נמצאו לינקים להורדה`;
          errorCount++;
          errorDetails.push(msg);

          // Capture body excerpt so we can see what the email actually
          // contained without going to Resend or the backup mailbox.
          const body = email.html || email.text || "";
          if (body) {
            diagnostics.bodyExcerpt = body.length > 8000 ? body.slice(0, 8000) : body;
          }
        }

        for (let i = 0; i < downloadedFiles.length; i++) {
          const file = downloadedFiles[i];
          const franchiseeMatch = await resolveFranchisee(
            file.buffer,
            "application/pdf",
            identifiedClient.parserCode,
            subject,
            allFranchisees as Franchisee[],
            file.fileName,
            documentType,
            inactiveFranchisees as Franchisee[],
          );

          if (isInactiveFranchiseeSkip(franchiseeMatch)) {
            duplicatesSkipped++;
            errorDetails.push(
              `דולג: לינק לזכיין סגור "${franchiseeMatch.inactiveFranchiseeName}" (${file.fileName})`,
            );
            continue;
          }

          let dlResult: ProcessClientDocumentResult | null = null;
          if (!franchiseeMatch.ok) {
            errorCount++;
            errorDetails.push(formatResolveFailure(franchiseeMatch, subject));
          } else {
            dlResult = await processClientDocument({
              buffer: file.buffer,
              fileName: file.fileName,
              mimeType: "application/pdf",
              clientId: identifiedClient.clientId,
              parserCode: identifiedClient.parserCode,
              franchiseeId: franchiseeMatch.franchiseeId,
              periodMonth: period.month,
              periodYear: period.year,
              documentType,
              source: "gmail_fetch",
              // CRITICAL: gmail_message_id has a UNIQUE index. When a single
              // email yields multiple downloaded files (e.g. multiple ezcount
              // links), every file must use a DISTINCT key — otherwise the
              // 2nd+ files are silently rejected as duplicates. Append the
              // index to keep the prefix `email_id#` stable and searchable.
              gmailMessageId: `${email_id}#dl${i}`,
            });

            if (dlResult.skippedDuplicate) {
              duplicatesSkipped++;
            } else if (dlResult.success) {
              documentsCreated++;
            } else {
              errorCount++;
              errorDetails.push(
                `${file.fileName}: ${dlResult.error ?? "שגיאה בעיבוד"}`
              );
            }
          }

          await recordInboundReviewOutcome({
            syncLogId: syncLog.id,
            emailId: `${email_id}#dl${i}`,
            emailSubject: subject,
            emailFrom: from,
            emailReceivedAt: email.createdAt ? new Date(email.createdAt) : null,
            clientId: identifiedClient.clientId,
            clientCode: identifiedClient.clientCode,
            documentType,
            franchiseeMatch,
            processResult: dlResult,
            fileContext: {
              buffer: file.buffer,
              fileName: file.fileName,
              mimeType: "application/pdf",
            },
            periodMonth: period.month,
            periodYear: period.year,
          });
        }
      }

      // Filter attachments: for Wolt, peek content to pick File B (sales
      // invoice to Wolt Enterprises); for others, pass through unchanged.
      const filteredAttachments = await filterAttachments(
        documentAttachments,
        identifiedClient.clientCode,
        downloadAttachment
      );

      for (const attachment of filteredAttachments) {
        const buffer = await downloadAttachment(attachment.downloadUrl);
        if (!buffer) {
          errorCount++;
          errorDetails.push(`לא ניתן להוריד קובץ: ${attachment.filename}`);
          continue;
        }

        // Resolve franchisee: parse document first, fall back to filename/subject.
        // Use the per-attachment documentType when filterAttachments tagged it
        // (Wolt File A vs File B); otherwise fall back to the subject-derived
        // documentType. Critical: commission_invoice docs need the invoice
        // parser (recipient = franchisee), client_report docs need the report
        // parser (issuer = franchisee).
        const attachmentDocumentType = attachment.documentType ?? documentType;
        const franchiseeMatch = await resolveFranchisee(
          buffer,
          attachment.contentType,
          identifiedClient.parserCode,
          subject,
          allFranchisees as Franchisee[],
          attachment.filename,
          attachmentDocumentType,
          inactiveFranchisees as Franchisee[],
        );

        if (isInactiveFranchiseeSkip(franchiseeMatch)) {
          duplicatesSkipped++;
          errorDetails.push(
            `דולג: קובץ לזכיין סגור "${franchiseeMatch.inactiveFranchiseeName}" (${attachment.filename})`,
          );
          continue;
        }

        const effectiveDocumentType = attachment.documentType ?? documentType;
        let attResult: ProcessClientDocumentResult | null = null;
        if (!franchiseeMatch.ok) {
          errorCount++;
          errorDetails.push(formatResolveFailure(franchiseeMatch, subject));
        } else {
          console.log(
            `[email-inbound] ${identifiedClient.clientCode}: processing "${attachment.filename}" as ${effectiveDocumentType}`
          );

          attResult = await processClientDocument({
            buffer,
            fileName: attachment.filename,
            mimeType: attachment.contentType,
            clientId: identifiedClient.clientId,
            parserCode: identifiedClient.parserCode,
            franchiseeId: franchiseeMatch.franchiseeId,
            periodMonth: period.month,
            periodYear: period.year,
            documentType: effectiveDocumentType,
            source: "gmail_fetch",
            // CRITICAL: gmail_message_id has a UNIQUE index. Wolt emails carry
            // BOTH File A (commission_invoice) AND File B (client_report) as
            // separate attachments — using just `email_id` made the 2nd one
            // get rejected as a duplicate, silently dropping File B (the file
            // needed for the Tabit reconciliation). The Resend attachment id
            // is a UUID, unique within the email, so this composite key keeps
            // re-deliveries idempotent while still allowing both attachments
            // through.
            gmailMessageId: `${email_id}#${attachment.id}`,
          });

          if (attResult.skippedDuplicate) {
            duplicatesSkipped++;
          } else if (attResult.success) {
            documentsCreated++;
          } else {
            errorCount++;
            errorDetails.push(
              `${attachment.filename}: ${attResult.error ?? "שגיאה בעיבוד"}`
            );
          }
        }

        await recordInboundReviewOutcome({
          syncLogId: syncLog.id,
          emailId: `${email_id}#${attachment.id}`,
          emailSubject: subject,
          emailFrom: from,
          emailReceivedAt: email.createdAt ? new Date(email.createdAt) : null,
          clientId: identifiedClient.clientId,
          clientCode: identifiedClient.clientCode,
          documentType: effectiveDocumentType,
          franchiseeMatch,
          processResult: attResult,
          fileContext: {
            buffer,
            fileName: attachment.filename,
            mimeType: attachment.contentType,
          },
          periodMonth: period.month,
          periodYear: period.year,
        });
      }
    }

    // ─── Step 8: Finalize sync log ─────────────────────────────────────
    const status =
      errorCount > 0 && documentsCreated === 0 ? "failed" : "completed";

    await finalizeSyncLog(syncLog.id, status, {
      messagesScanned,
      documentsCreated,
      duplicatesSkipped,
      errorCount,
      errorDetails: errorDetails.length > 0 ? errorDetails : undefined,
      ...diagnostics,
    });

    console.log(
      `[email-inbound] Done: ${documentsCreated} created, ${duplicatesSkipped} skipped, ${errorCount} errors`
    );

    return NextResponse.json({
      received: true,
      processed: true,
      documentsCreated,
      duplicatesSkipped,
      errorCount,
    });
  } catch (error) {
    const errorMessage =
      error instanceof Error ? error.message : String(error);
    console.error("[email-inbound] Unhandled error:", errorMessage);

    await finalizeSyncLog(syncLog.id, "failed", {
      messagesScanned,
      documentsCreated,
      duplicatesSkipped,
      errorCount: errorCount + 1,
      errorDetails: [...errorDetails, errorMessage],
      ...diagnostics,
    });

    // Always return 200 to prevent Resend retries
    return NextResponse.json({
      received: true,
      processed: false,
      error: errorMessage,
    });
  }
}

/**
 * GET /api/clients/email-inbound — Health check
 */
export async function GET() {
  return NextResponse.json({
    status: "ok",
    endpoint: "Resend Inbound webhook (client emails)",
    configured: !!process.env.RESEND_INBOUND_WEBHOOK_SECRET,
  });
}

// ============================================================================
// HELPERS
// ============================================================================

/** Sentinel values the parser uses when it cannot identify the franchisee */
const UNKNOWN_FRANCHISEE_NAMES = new Set(["לא זוהה", ""]);

/**
 * Narrow a failure result to the "skip silently because the franchisee is
 * closed" variant. Used by every resolveFranchisee call site so the daily
 * Pluxee/Mishloha/etc. emails for closed branches don't pile up as
 * gmail_sync_log failures.
 */
function isInactiveFranchiseeSkip(
  match: ResolveFranchiseeResult,
): match is Extract<
  ResolveFranchiseeResult,
  { ok: false; skipReason: "inactive_franchisee" }
> {
  return !match.ok && "skipReason" in match && match.skipReason === "inactive_franchisee";
}

/**
 * Resolve franchisee using multiple strategies, in order:
 *
 * 1. Parse document → extract franchiseeName → fuzzy match
 * 2. Attachment filename (e.g. Wolt: "קינג קונג חדרה הכשר__sales_report__...")
 * 3. Email subject matching
 */
type ResolveFranchiseeResult =
  | {
      ok: true;
      franchiseeId: string;
      franchiseeName: string;
      confidence: number;
      /**
       * Layer 3 borderline flag. True when confidence is in the
       * [0.85, 0.95) band: the document still commits, but the inbox
       * row is marked `needs_review` so an admin double-checks the
       * franchisee assignment.
       */
      needsReview?: boolean;
    }
  | {
      ok: false;
      skipReason: "inactive_franchisee";
      /**
       * Name of the matched inactive franchisee, surfaced into the sync
       * log so an admin can confirm "yes, this branch is closed — Pluxee
       * is still sending us reports for it" without re-opening the email.
       */
      inactiveFranchiseeName: string;
      confidence: number;
    }
  | {
      ok: false;
      // Diagnostics: what was tried and why it failed. Surfaced into
      // gmail_sync_log.error_details so we can debug without asking the
      // user to forward the original email each time.
      extractedName?: string;
      filenameAttempt?: string;
      reason: string;
      /**
       * Best rejected verdict across all strategies (if any). Captures the
       * top candidates so an admin can see "we considered these franchisees
       * but the confidence was too low or ambiguous". Populated when
       * `decideFranchiseeAcceptance` returns a non-accepting verdict.
       */
      rejectedVerdict?: Extract<AcceptanceVerdict, { accept: false }>;
    };

async function resolveFranchisee(
  buffer: Buffer,
  mimeType: string,
  parserCode: string,
  subject: string,
  franchisees: Franchisee[],
  attachmentFilename?: string,
  documentType: "client_report" | "commission_invoice" = "client_report",
  /**
   * Full franchisee list (active + inactive). When provided, a final
   * pass tries matching the extracted name against inactive entries; a
   * high-confidence hit returns the `inactive_franchisee` skip reason so
   * the caller can drop the email silently instead of failing daily for
   * a closed branch (e.g. Pluxee → קינג קונג מוצקין).
   */
  inactiveFranchisees?: Franchisee[]
): Promise<ResolveFranchiseeResult> {
  // Track the best rejected verdict across all strategies so the final
  // failure message can surface "we considered these candidates" instead
  // of just "no match found".
  let bestRejectedVerdict: Extract<AcceptanceVerdict, { accept: false }> | undefined;
  const recordRejection = (
    verdict: Extract<AcceptanceVerdict, { accept: false }>,
  ) => {
    if (
      !bestRejectedVerdict ||
      verdict.bestConfidence > bestRejectedVerdict.bestConfidence
    ) {
      bestRejectedVerdict = verdict;
    }
  };

  // Strategy 1: Parse document and use extracted franchisee name.
  // Critical: commission invoices (Mishloha, Wolt, etc.) have a SEPARATE
  // parser registered under getInvoiceParser — the sales/report parser has
  // different franchisee-extraction logic (issuer vs recipient).
  const parser =
    documentType === "commission_invoice"
      ? getInvoiceParser(parserCode)
      : getClientParser(parserCode);
  let extractedName: string | undefined;
  if (parser) {
    try {
      const parseResult = await parser(buffer, mimeType);
      if (
        parseResult.success &&
        parseResult.data?.franchiseeName &&
        !UNKNOWN_FRANCHISEE_NAMES.has(parseResult.data.franchiseeName)
      ) {
        extractedName = parseResult.data.franchiseeName;

        // Parent-legal-entity override (e.g. Pat Vini Azrieli → Natanzon
        // Azrieli Haifa). When the extracted name is a parent legal entity
        // that issues invoices on behalf of an operating-brand franchisee,
        // route the document to the operating brand rather than fuzzy-
        // matching the legal entity. Confirmed by Asaf 2026-04-30 for
        // Mishlocha invoice 157159 and applies here for the May 2026 Wolt
        // outage (memory: feedback-franchisee-resolution-rules).
        //
        // Content gate (2026-05-10): we now also require the operating-
        // brand keyword to appear in the parsed line items / rawText, so
        // documents that genuinely belong to the parent legal entity (no
        // mention of the operating brand) fall through to the fuzzy match
        // instead of being kidnapped to the operating-brand franchisee.
        const contentText = [
          parseResult.data.rawText ?? "",
          ...(parseResult.data.lineItems ?? []).map((li) => li.description ?? ""),
        ].join("\n");
        const parentOverride = findOperatingBrand(extractedName, contentText);
        if (parentOverride) {
          const operatingFranchisee = franchisees.find(
            (f) => f.id === parentOverride.operatingFranchiseeId
          );
          if (operatingFranchisee) {
            console.log(
              `[email-inbound] Parent-map override: "${extractedName}" → "${parentOverride.operatingFranchiseeName}" (operating brand)`
            );
            return {
              ok: true,
              franchiseeId: parentOverride.operatingFranchiseeId,
              franchiseeName: parentOverride.operatingFranchiseeName,
              confidence: 1,
            };
          }
          // Operating-brand franchisee not active — fall through to fuzzy match.
          console.warn(
            `[email-inbound] Parent-map matched "${extractedName}" but operating franchisee ${parentOverride.operatingFranchiseeId} is not in the active list — falling back to fuzzy match`
          );
        }

        // Strict acceptance gate (replaces 2026-pre `minConfidence: 0.6`
        // first-match-wins behaviour). Anything < 0.85 or with a close
        // runner-up is rejected here; the email is held back instead of
        // being committed to the wrong franchisee.
        const match = matchFranchiseeName(extractedName, franchisees, {
          minConfidence: 0.7,
        });
        const verdict = decideFranchiseeAcceptance(match);
        if (verdict.accept) {
          console.log(
            `[email-inbound] Matched franchisee from document content: "${extractedName}" → "${verdict.franchiseeName}" @${verdict.confidence.toFixed(2)}${verdict.needsReview ? " [needs_review]" : ""}`
          );
          return {
            ok: true,
            franchiseeId: verdict.franchiseeId,
            franchiseeName: verdict.franchiseeName,
            confidence: verdict.confidence,
            needsReview: verdict.needsReview,
          };
        }
        recordRejection(verdict);
        console.warn(
          `[email-inbound] Document-content match rejected: ${formatVerdictForLog(verdict)} (extracted="${extractedName}")`
        );
      }
    } catch (err) {
      console.warn("[email-inbound] Pre-parse for franchisee extraction failed:", err);
    }
  }

  // Strategy 2: Extract branch name from attachment filename
  // Wolt filenames: "{branch}__sales_report__monthly__{start}__{end}.pdf"
  if (attachmentFilename) {
    const filenameMatch = matchFranchiseeFromFilename(
      attachmentFilename,
      franchisees,
      recordRejection,
    );
    if (filenameMatch) {
      console.log(
        `[email-inbound] Matched franchisee from filename: "${attachmentFilename}" → "${filenameMatch.franchiseeName}" @${filenameMatch.confidence.toFixed(2)}`
      );
      return { ok: true, ...filenameMatch };
    }
  }

  // Strategy 3: Fall back to subject matching
  const subjectMatch = matchFranchiseeFromSubject(
    subject,
    franchisees,
    recordRejection,
  );
  if (subjectMatch) {
    return { ok: true, ...subjectMatch };
  }

  // Strategy 4: Inactive-franchisee detection (silent-skip path).
  // When the active strategies failed but the extracted name (or filename,
  // or subject) high-confidence matches a CLOSED branch, we don't want to
  // keep failing daily for it. Drop the email silently and tell the admin
  // via the sync log that an inactive franchisee was matched.
  if (inactiveFranchisees && inactiveFranchisees.length > 0) {
    const allCandidates = [...franchisees, ...inactiveFranchisees];
    const inactiveAttempts = [
      extractedName,
      attachmentFilename,
      subject,
    ].filter((v): v is string => !!v && v.trim().length >= 3);

    for (const attempt of inactiveAttempts) {
      const result = matchFranchiseeName(attempt, allCandidates, {
        minConfidence: 0.7,
        includeInactive: true,
      });
      if (
        result.matchedFranchisee &&
        !result.matchedFranchisee.isActive &&
        result.confidence >= 0.85
      ) {
        return {
          ok: false,
          skipReason: "inactive_franchisee",
          inactiveFranchiseeName: result.matchedFranchisee.name,
          confidence: result.confidence,
        };
      }
    }
  }

  return {
    ok: false,
    extractedName,
    filenameAttempt: attachmentFilename,
    reason: extractedName
      ? `Extracted "${extractedName}" but no franchisee match passed the acceptance gate (≥0.85 confidence, no ambiguity)`
      : "Parser did not extract a franchisee name; filename and subject also did not pass the acceptance gate",
    rejectedVerdict: bestRejectedVerdict,
  };
}

/**
 * Layer 2 visibility hook — record every inbound email's outcome to
 * `inbound_review_queue` so the admin UI can show what arrived without
 * scraping `gmail_sync_log.error_details`.
 *
 * Failures here MUST NOT propagate. The webhook already returned 200 to
 * Resend in the success path; we log and continue.
 */
/**
 * Layer 2b file-context provider. When the franchisee resolver fails,
 * we still upload the file so the admin can later confirm with a
 * manually-picked franchisee from the inbox UI. Best-effort — failures
 * are non-fatal.
 */
async function uploadForReviewQueue(args: {
  buffer: Buffer;
  fileName: string;
  mimeType: string;
  clientId: string | null;
}): Promise<{ url: string; size: number } | null> {
  try {
    const entityId = args.clientId ?? "inbound-review";
    const result = await uploadDocument(
      args.buffer,
      args.fileName,
      args.mimeType,
      "inbound-review",
      entityId,
    );
    return { url: result.url, size: result.fileSize };
  } catch (err) {
    console.warn(
      "[email-inbound] failed to pre-upload file for review queue:",
      err,
    );
    return null;
  }
}

async function recordInboundReviewOutcome(args: {
  syncLogId: string;
  emailId: string;
  emailSubject: string;
  emailFrom: string | null;
  emailReceivedAt: Date | null;
  clientId: string | null;
  clientCode: string | null;
  documentType: "client_report" | "commission_invoice" | "tabit_report";
  // Skip variant ({ skipReason: "inactive_franchisee" }) never reaches
  // this function — all call sites early-return before invoking it. So
  // the type is narrowed to either success or a regular failure.
  franchiseeMatch: Exclude<
    ResolveFranchiseeResult,
    { skipReason: "inactive_franchisee" }
  >;
  processResult: ProcessClientDocumentResult | null;
  /**
   * File context — populated when the file is available (always for
   * attachments and downloaded links; null for body-based emails where
   * a full upload would just be a copy of the email body).
   */
  fileContext?: {
    buffer: Buffer;
    fileName: string;
    mimeType: string;
  } | null;
  periodMonth?: number;
  periodYear?: number;
}): Promise<void> {
  try {
    let status: InboundReviewStatus;
    let failureReason: string | null = null;
    let committedClientDocumentId: string | null = null;
    let proposedFranchiseeId: string | null = null;
    let proposedFranchiseeName: string | null = null;
    let franchiseeConfidence: string | null = null;
    let franchiseeAlternatives:
      | Array<{ id: string; name: string; confidence: number }>
      | null = null;

    if (!args.franchiseeMatch.ok) {
      status = "failed";
      failureReason = args.franchiseeMatch.reason;
      const verdict = args.franchiseeMatch.rejectedVerdict;
      if (verdict) {
        franchiseeConfidence = verdict.bestConfidence.toFixed(3);
        franchiseeAlternatives = verdict.candidates;
        if (verdict.candidates.length > 0) {
          proposedFranchiseeId = verdict.candidates[0].id;
          proposedFranchiseeName = verdict.candidates[0].name;
        }
      }
    } else {
      proposedFranchiseeId = args.franchiseeMatch.franchiseeId;
      proposedFranchiseeName = args.franchiseeMatch.franchiseeName;
      franchiseeConfidence = args.franchiseeMatch.confidence.toFixed(3);
      if (args.processResult?.skippedDuplicate) {
        // Don't pollute the queue with re-deliveries — gmail_sync_log
        // already counts them via duplicates_skipped.
        return;
      }
      if (args.processResult?.success && args.processResult.document) {
        // Borderline matches (0.85 ≤ confidence < 0.95 or filename/subject
        // strategies that fall in the same band) commit normally but get
        // flagged needs_review so the inbox surfaces them for verification.
        // High-confidence matches and parent-map overrides skip the flag.
        status = args.franchiseeMatch.needsReview
          ? "needs_review"
          : "auto_committed";
        committedClientDocumentId = args.processResult.document.id;
      } else {
        status = "failed";
        failureReason = args.processResult?.error ?? "processing failed";
      }
    }

    // File-context capture rules:
    //  - Auto-committed rows: take the URL from the created client_document
    //    (already uploaded by processClientDocument). No separate upload.
    //  - Failed rows with attachments: upload now so admin can recover via
    //    the review dialog without re-fetching the email from Resend.
    //  - Body-based emails on failure: skip — the body is in
    //    gmail_sync_log.body_excerpt; an extra blob copy adds no value.
    let fileUrl: string | null = null;
    let fileName: string | null = null;
    let fileSize: number | null = null;
    let mimeType: string | null = null;
    if (args.processResult?.document) {
      const doc = args.processResult.document;
      fileUrl = doc.fileUrl;
      fileName = doc.originalFileName;
      fileSize = doc.fileSize;
      mimeType = doc.mimeType;
    } else if (args.fileContext && status === "failed") {
      const uploaded = await uploadForReviewQueue({
        buffer: args.fileContext.buffer,
        fileName: args.fileContext.fileName,
        mimeType: args.fileContext.mimeType,
        clientId: args.clientId,
      });
      if (uploaded) {
        fileUrl = uploaded.url;
        fileSize = uploaded.size;
        fileName = args.fileContext.fileName;
        mimeType = args.fileContext.mimeType;
      }
    }

    await createInboundReviewEntry({
      gmailSyncLogId: args.syncLogId,
      gmailMessageId: args.emailId,
      emailSubject: args.emailSubject,
      emailFrom: args.emailFrom,
      emailReceivedAt: args.emailReceivedAt,
      clientId: args.clientId,
      clientCode: args.clientCode,
      proposedFranchiseeId,
      proposedFranchiseeName,
      franchiseeConfidence,
      franchiseeAlternatives,
      resolutionStrategy: null,
      proposedDocumentType: args.documentType,
      docTypeSource: null,
      fileUrl,
      fileName,
      mimeType,
      fileSize,
      parsedData: null,
      periodMonth: args.periodMonth ?? null,
      periodYear: args.periodYear ?? null,
      status,
      failureReason,
      committedClientDocumentId,
    });
  } catch (err) {
    // Non-fatal — webhook continues even if visibility insert fails.
    console.warn(
      "[email-inbound] failed to record inbound_review_queue entry:",
      err,
    );
  }
}

function formatResolveFailure(
  failure: Extract<
    ResolveFranchiseeResult,
    { ok: false; reason: string }
  >,
  subject: string
): string {
  // Single-line, Hebrew-fronted, with English diagnostics tail. Stored in
  // gmail_sync_log.error_details — visible in the cron-monitor admin UI.
  const parts: string[] = [`לא זוהה זכיין מהמסמך או מנושא המייל: "${subject}"`];
  if (failure.extractedName) {
    parts.push(`extracted="${failure.extractedName}"`);
  }
  if (failure.filenameAttempt) {
    parts.push(`filename="${failure.filenameAttempt}"`);
  }
  parts.push(`reason=${failure.reason}`);
  if (failure.rejectedVerdict) {
    // Surface top candidates so the admin can see what was considered
    // and pick a franchisee manually (or update aliases) rather than
    // having to re-fetch and re-parse the email from scratch.
    parts.push(formatVerdictForLog(failure.rejectedVerdict));
  }
  return parts.join(" | ");
}

/**
 * Try to match a franchisee from the attachment filename.
 * Handles patterns like:
 * - Wolt: "קינג קונג חדרה הכשר__sales_report__monthly__2026-03-01__2026-04-01.pdf"
 * - Generic: "branch_name_report.pdf"
 */
function matchFranchiseeFromFilename(
  filename: string,
  franchisees: Franchisee[],
  recordRejection?: (
    verdict: Extract<AcceptanceVerdict, { accept: false }>,
  ) => void,
): {
  franchiseeId: string;
  franchiseeName: string;
  confidence: number;
  needsReview: boolean;
} | null {
  if (!filename || franchisees.length === 0) return null;

  // Strip extension
  const withoutExt = filename.replace(/\.[^.]+$/, "");

  const tryCandidate = (
    candidate: string,
  ): {
    franchiseeId: string;
    franchiseeName: string;
    confidence: number;
    needsReview: boolean;
  } | null => {
    if (candidate.length < 3) return null;
    const result = matchFranchiseeName(candidate, franchisees, {
      minConfidence: 0.7,
    });
    const verdict = decideFranchiseeAcceptance(result);
    if (verdict.accept) {
      return {
        franchiseeId: verdict.franchiseeId,
        franchiseeName: verdict.franchiseeName,
        confidence: verdict.confidence,
        needsReview: verdict.needsReview,
      };
    }
    if (verdict.reason !== "no_match") {
      recordRejection?.(verdict);
    }
    return null;
  };

  // Split on double underscore — Wolt legacy: "{branch}__sales_report__..."
  const doubleUnderscoreParts = withoutExt.split("__");
  if (doubleUnderscoreParts.length > 1) {
    const found = tryCandidate(doubleUnderscoreParts[0].trim());
    if (found) return found;
  }

  // Wolt ezcount (File B): "<heb...>_<...>_<hebCity>_<date>_<time>_<hash>.pdf"
  // Filename may be all-Hebrew (e.g. "מינה_טומיי_חיפה_...") or include an
  // English business-name token (e.g. "נתנזון_NATANZON_חיפה_..."). In both
  // cases we collect the Hebrew tokens to build the branch candidate.
  const singleUnderscoreParts = withoutExt.split("_");
  const hebrewTokens = singleUnderscoreParts.filter((p) =>
    /^[\u0590-\u05FF][\u0590-\u05FF ]*$/.test(p)
  );
  if (hebrewTokens.length >= 1) {
    const found = tryCandidate(hebrewTokens.join(" ").trim());
    if (found) return found;
  }

  // Also try the full filename (minus extension) for less structured names
  const cleaned = withoutExt
    .replace(/[_-]+/g, " ")
    .replace(/\d{4}[-/]\d{2}[-/]\d{2}/g, "") // remove dates
    .replace(/\b(sales|report|monthly|invoice|חשבונית|דוח)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  return tryCandidate(cleaned);
}

/**
 * Try to match a franchisee from the email subject.
 * Removes common prefixes/patterns to isolate the branch name.
 */
function matchFranchiseeFromSubject(
  subject: string,
  franchisees: Franchisee[],
  recordRejection?: (
    verdict: Extract<AcceptanceVerdict, { accept: false }>,
  ) => void,
): {
  franchiseeId: string;
  franchiseeName: string;
  confidence: number;
  needsReview: boolean;
} | null {
  if (!subject || franchisees.length === 0) return null;

  // Try the full subject first (after removing common prefixes)
  const cleanedSubject = subject
    // Standard forward/reply prefixes (English + Hebrew)
    .replace(/^(fwd?|re|fw|subject):\s*/gi, "")
    .replace(/\[העתק\]\s*/g, "")
    .replace(/\[העברה\]\s*/g, "")
    // Monthly report prefixes
    .replace(/ריכוז חיוב חודשי\s*[-–—]\s*/g, "")
    .replace(/דוח חודשי\s*(מתן ביס|תן ביס|סיבוס|pluxee|cibus|tenbis|וולט|wolt|האט|haat|משלוחה|חבר)\s*[-–—ל]?\s*/gi, "")
    .replace(/דוח חודשי\s*[-–—]\s*/g, "")
    .replace(/monthly\s+report\s*[-–—]\s*/gi, "")
    // Invoice subjects: "חשבונית מס 10013 מאת ..." → keep only what's after "מאת"
    .replace(/חשבונית\s+(?:מס\s*)?\d+\s+מאת\s*/g, "")
    // ezcount generic subjects: "EasyCount Invoice for HAAT" → no franchisee info
    .replace(/EasyCount\s+Invoice\s+for\s+\w+/gi, "")
    .trim();

  // Split by common delimiters and try each part
  const parts = cleanedSubject.split(/\s*[-–—|,]\s*/);

  for (const part of parts) {
    const trimmed = part.trim();
    if (trimmed.length < 3) continue;

    const result = matchFranchiseeName(trimmed, franchisees, {
      minConfidence: 0.75,
    });
    const verdict = decideFranchiseeAcceptance(result);
    if (verdict.accept) {
      return {
        franchiseeId: verdict.franchiseeId,
        franchiseeName: verdict.franchiseeName,
        confidence: verdict.confidence,
        needsReview: verdict.needsReview,
      };
    }
    if (verdict.reason !== "no_match") {
      recordRejection?.(verdict);
    }
  }

  return null;
}

type Attachment = {
  /** Resend attachment ID — UUID unique within the email. */
  id: string;
  filename: string;
  contentType: string;
  downloadUrl: string;
  /**
   * Set when filterAttachments has classified this attachment per-file (Wolt).
   * Overrides the subject-based `documentType` derived from the email subject.
   */
  documentType?: "client_report" | "commission_invoice";
};

/**
 * Filter attachments to pick the most relevant documents per client.
 *
 * Wolt emails contain ~4-5 attachments per branch:
 *   - `image001.png` (email signature, inline image — ignored earlier)
 *   - Two ezcount PDFs with near-identical filenames (only trailing hash
 *     differs). Content distinguishes them:
 *       - **File A** = Wolt's commission invoice to the restaurant
 *         (`commission_invoice` — what we verify on the commission-invoices
 *         page). Identified as the ezcount PDF that is **not** File B.
 *       - **File B** = restaurant's sales invoice to Wolt Enterprises
 *         (`client_report` — gross sales, matched via `isWoltEzcountFileB`).
 *   - `__sales_report__` (transaction breakdown; legacy fallback for File B)
 *   - `__netting_report__` (settlement doc, ignored)
 *
 * We return both File A and File B, each tagged with its intended
 * `documentType`. The caller uses `attachment.documentType` (set here) to
 * override the subject-based classification, since a single Wolt email
 * carries both document types.
 *
 * For non-Wolt clients, returns all attachments unchanged (no per-file
 * documentType; the caller falls back to the subject-based classifier).
 */
async function filterAttachments(
  attachments: Attachment[],
  clientCode: string,
  download: (url: string) => Promise<Buffer | null>
): Promise<Attachment[]> {
  if (clientCode !== "WOLT") return attachments;

  // Candidate ezcount PDFs: Hebrew-first single-underscore filename, not a
  // report/netting/commission doc.
  const ezcountCandidates = attachments.filter((a) => {
    if (a.contentType !== "application/pdf") return false;
    const lower = a.filename.toLowerCase();
    if (/sales_report|netting|commission/.test(lower)) return false;
    // Hebrew token followed by a single underscore (not "__")
    return /^[\u0590-\u05FF][\u0590-\u05FF ]*_(?!_)/.test(a.filename);
  });

  // Score every candidate. With the new content-rich classifier we get a
  // verdict (`fileA` / `fileB` / `unknown`) plus the underlying scores so
  // we can pick the BEST File B (highest score, ties broken by order)
  // and treat the remainder as File A without ever silently dropping a
  // file — the May 2026 outage was caused by exactly that silent drop.
  type Scored = {
    attachment: Attachment;
    fileBScore: number;
    fileAScore: number;
    verdict: "fileA" | "fileB" | "unknown";
    signals: readonly string[];
  };
  const scored: Scored[] = [];
  for (const candidate of ezcountCandidates) {
    const buf = await download(candidate.downloadUrl);
    if (!buf) continue;
    const result = await classifyWoltEzcountAttachment(buf, candidate.filename);
    scored.push({
      attachment: candidate,
      fileBScore: result.fileBScore,
      fileAScore: result.fileAScore,
      verdict: result.verdict,
      signals: result.signals,
    });
    console.log(
      `[email-inbound] Wolt: scored "${candidate.filename}" → verdict=${result.verdict} fileB=${result.fileBScore} fileA=${result.fileAScore} signals=[${result.signals.join(", ")}]`
    );
  }

  // Pick File B = highest fileBScore that crosses the confidence floor (≥3).
  // Everything else is File A, in the order Resend gave us them.
  const fileBCandidate = [...scored]
    .filter((s) => s.fileBScore >= 3)
    .sort((a, b) => b.fileBScore - a.fileBScore)[0];

  const results: Attachment[] = [];
  for (const s of scored) {
    if (s === fileBCandidate) {
      results.push({ ...s.attachment, documentType: "client_report" });
    } else {
      results.push({ ...s.attachment, documentType: "commission_invoice" });
    }
  }

  // Defensive fallback for the client_report side only: if no decisive
  // File B emerged from the ezcount PDFs, prefer a `sales_report`
  // attachment if one exists (older Wolt format, no `netAmount`).
  if (!fileBCandidate) {
    const salesReport = attachments.find((a) =>
      a.filename.toLowerCase().includes("sales_report")
    );
    if (salesReport && !results.some((r) => r.id === salesReport.id)) {
      console.warn(
        `[email-inbound] Wolt: no decisive File B in ${ezcountCandidates.length} ezcount PDFs — using sales_report fallback: ${salesReport.filename}`
      );
      results.push({ ...salesReport, documentType: "client_report" });
    } else {
      console.warn(
        `[email-inbound] Wolt: no decisive File B in ${ezcountCandidates.length} ezcount PDFs and no sales_report fallback — all ezcount candidates will be processed as commission_invoice`
      );
    }
  }

  if (results.length === 0) {
    console.warn(
      `[email-inbound] Wolt: neither File A nor File B nor sales_report found in ${attachments.length} attachments`
    );
  }

  return results;
}

/**
 * Extract download links from email HTML body and download the PDFs.
 * Supports:
 * - Tenbis monthly reports: Mandrill tracking links wrapping cdn.10bis.co.il PDFs
 * - Tenbis tax invoices (חשבונית מס): invoice-one.com Y_GreeViewer pages
 *   that resolve to a Download endpoint returning the PDF as octet-stream
 * - ezcount (Mishloha, Haat): files.ezcount.co.il links that 302 to S3 PDFs
 */
async function extractAndDownloadLinks(
  htmlBody: string,
  clientCode: string
): Promise<Array<{ buffer: Buffer; fileName: string }>> {
  const results: Array<{ buffer: Buffer; fileName: string }> = [];

  // Pattern 1: Tenbis monthly reports — Mandrill tracking links with
  // base64-encoded target URL. The `p` param JSON-decodes to an object whose
  // `url` field is the real cdn.10bis.co.il PDF.
  if (clientCode === "TENBIS") {
    const mandrillLinks = htmlBody.match(
      /https?:\/\/mandrillapp\.com\/track\/click\/[^"'\s<>]+/g
    ) || [];

    for (const trackingLink of mandrillLinks) {
      try {
        const url = new URL(trackingLink.replace(/&amp;/g, "&"));
        const pParam = url.searchParams.get("p");
        if (!pParam) continue;

        const decoded = JSON.parse(Buffer.from(pParam, "base64").toString());
        const innerData = JSON.parse(decoded.p);
        const pdfUrl: string = innerData.url;

        // SSRF guard: pdfUrl is decoded from attacker-influenceable email body.
        // Validate with an exact-host allowlist (not a substring match) over
        // https, and disable redirects so a 302 can't bounce us off-host.
        let parsedUrl: URL;
        try {
          parsedUrl = new URL(pdfUrl);
        } catch {
          continue;
        }
        const host = parsedUrl.hostname.toLowerCase().replace(/\.$/, "");
        if (
          parsedUrl.protocol !== "https:" ||
          (host !== "cdn.10bis.co.il" && !host.endsWith(".cdn.10bis.co.il")) ||
          !parsedUrl.pathname.toLowerCase().endsWith(".pdf")
        )
          continue;
        // Only download report PDFs (skip refund reports)
        if (pdfUrl.includes("refund_")) continue;

        console.log(`[email-inbound] Tenbis: downloading PDF from ${pdfUrl}`);
        const response = await fetch(pdfUrl, { redirect: "manual" });
        // 3xx (redirect) has response.ok === false → treated as failure below
        if (!response.ok) {
          console.warn(`[email-inbound] Failed to download ${pdfUrl}: ${response.status}`);
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const fileName = pdfUrl.split("/").pop() ?? "tenbis-report.pdf";

        results.push({ buffer, fileName });
      } catch (err) {
        console.warn("[email-inbound] Failed to decode Mandrill link:", err);
      }
    }

    // Pattern 1b: Tenbis tax invoices (חשבונית מס) — these come via the
    // invoice-one.com viewer, NOT Mandrill. Each email contains a viewer
    // URL like:
    //   https://invoice-one.com/ViewerNew/pages/Y_GreeViewer_document/<DOCID>
    // The PDF itself is at:
    //   https://invoice-one.com/ViewerNew/api/GreeViewer/Document/Download?DocumentID=<DOCID>
    // (returns application/octet-stream; the same DocID also appears in the
    // SetMailOpened tracking pixel inside the email body.)
    if (results.length === 0) {
      const viewerLinks = [
        ...htmlBody.matchAll(
          /https?:\/\/(?:www\.)?invoice-one\.com\/ViewerNew\/pages\/Y_GreeViewer_document\/(\w+)/gi
        ),
      ];
      // Dedupe by DocumentID — forwarded emails often carry the same link
      // both inline and as href, plus the SetMailOpened tracking-pixel URL.
      const docIds = [...new Set(viewerLinks.map((m) => m[1]))];

      for (const docId of docIds) {
        const pdfUrl = `https://invoice-one.com/ViewerNew/api/GreeViewer/Document/Download?DocumentID=${docId}`;
        try {
          console.log(`[email-inbound] Tenbis: downloading invoice from ${pdfUrl}`);
          const response = await fetch(pdfUrl);
          if (!response.ok) {
            console.warn(`[email-inbound] Failed to download ${pdfUrl}: ${response.status}`);
            continue;
          }
          const contentType = response.headers.get("content-type") ?? "";
          // The endpoint returns application/octet-stream when the doc exists
          // and text/html (the SPA shell) when the DocID is invalid. Skip the
          // HTML case so we don't try to PDF-parse an Angular index page.
          if (
            !contentType.includes("octet-stream") &&
            !contentType.includes("application/pdf")
          ) {
            console.warn(
              `[email-inbound] invoice-one.com returned non-PDF content-type "${contentType}" for DocID ${docId} — skipping`
            );
            continue;
          }
          const arrayBuffer = await response.arrayBuffer();
          const buffer = Buffer.from(arrayBuffer);
          results.push({
            buffer,
            fileName: `tenbis-invoice-${docId}.pdf`,
          });
        } catch (err) {
          console.warn(
            `[email-inbound] Failed to download invoice-one.com PDF (DocID ${docId}):`,
            err
          );
        }
      }
    }
  }

  // Pattern 2: ezcount (Mishloha, Haat) — files.ezcount.co.il download links
  // These redirect (302) to an S3 URL with the actual PDF
  if (results.length === 0) {
    const ezLinks =
      htmlBody.match(
        /https?:\/\/files\.ezcount\.co\.il\/front\/documents\/get\/[^"'\s<>]+/g
      ) || [];

    for (const ezUrl of ezLinks) {
      try {
        const cleanUrl = ezUrl.replace(/&amp;/g, "&");
        console.log(`[email-inbound] ezcount: downloading PDF from ${cleanUrl}`);
        // Follow the 302 redirect to S3
        const response = await fetch(cleanUrl, { redirect: "follow" });
        if (!response.ok) {
          console.warn(
            `[email-inbound] Failed to download ezcount PDF: ${response.status}`
          );
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);

        // Extract UUID from URL for filename
        const uuidMatch = cleanUrl.match(
          /get\/([0-9a-f-]+)\//
        );
        const fileName = uuidMatch
          ? `ezcount-${uuidMatch[1]}.pdf`
          : "ezcount-invoice.pdf";

        results.push({ buffer, fileName });
      } catch (err) {
        console.warn("[email-inbound] Failed to download ezcount PDF:", err);
      }
    }
  }

  // Pattern 3: Direct PDF links (generic fallback) — covers HAAT (Azure
  // Blob), occasional Wolt/Mishloha direct links, and anything else that
  // posts a PDF URL straight in the body.
  //
  // CRITICAL: query strings must be preserved. HAAT links carry a SAS token
  // appended after `.pdf` (`?sv=...&sig=...`); without it Azure returns 403.
  if (results.length === 0) {
    const directLinks =
      htmlBody.match(
        /https?:\/\/[^\s"'<>]+\.pdf(?:\?[^\s"'<>]*)?/gi
      ) || [];

    // De-dup — HTML often repeats the same URL (text + href).
    const uniqueLinks = [...new Set(directLinks.map((u) => u.replace(/&amp;/g, "&")))];

    for (const pdfUrl of uniqueLinks) {
      try {
        console.log(`[email-inbound] Downloading direct PDF: ${pdfUrl}`);
        const response = await fetch(pdfUrl);
        if (!response.ok) {
          console.warn(
            `[email-inbound] Direct PDF download failed: ${response.status} ${response.statusText} (${pdfUrl})`
          );
          continue;
        }

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        // Strip query string from filename — keep only the actual `.pdf`
        // basename, never the SAS token.
        const fileName =
          pdfUrl.split("?")[0].split("/").pop() ?? "report.pdf";

        results.push({ buffer, fileName });
      } catch (err) {
        console.warn("[email-inbound] Failed to download PDF:", err);
      }
    }
  }

  return results;
}

async function finalizeSyncLog(
  id: string,
  status: string,
  stats: {
    messagesScanned: number;
    documentsCreated: number;
    duplicatesSkipped: number;
    errorCount: number;
    errorDetails?: string[];
    // Diagnostics — captured into gmail_sync_log so production failures can
    // be debugged from the cron-monitor admin UI without forwarding the
    // original email or chasing Vercel console logs.
    emailId?: string | null;
    fromAddress?: string | null;
    toAddresses?: string[] | null;
    subject?: string | null;
    clientCode?: string | null;
    identifiedBy?: string | null;
    rawAttachments?: Array<{ filename: string; contentType: string; size: number }> | null;
    rawAttachmentCount?: number | null;
    filteredAttachmentCount?: number | null;
    bodyExcerpt?: string | null;
  }
) {
  await updateSyncLogEntry(id, {
    status: status as "running" | "completed" | "failed",
    messagesScanned: stats.messagesScanned,
    documentsCreated: stats.documentsCreated,
    duplicatesSkipped: stats.duplicatesSkipped,
    errorCount: stats.errorCount,
    errorDetails: stats.errorDetails,
    runCompletedAt: new Date(),
    emailId: stats.emailId ?? null,
    fromAddress: stats.fromAddress ?? null,
    toAddresses: stats.toAddresses ?? null,
    subject: stats.subject ?? null,
    clientCode: stats.clientCode ?? null,
    identifiedBy: stats.identifiedBy ?? null,
    rawAttachments: stats.rawAttachments ?? null,
    rawAttachmentCount: stats.rawAttachmentCount ?? null,
    filteredAttachmentCount: stats.filteredAttachmentCount ?? null,
    bodyExcerpt: stats.bodyExcerpt ?? null,
  });
}
