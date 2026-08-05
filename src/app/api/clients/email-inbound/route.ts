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
import {
  createSyncLogEntry,
  updateSyncLogEntry,
} from "@/data-access/gmail-sync";
import { createInboundReviewEntry } from "@/data-access/inbound-review-queue";
import { uploadDocument } from "@/lib/storage";
import type { InboundReviewStatus } from "@/db/schema";
import type { ProcessClientDocumentResult } from "@/lib/client-document-processor";
import {
  classifyWoltEzcountAttachment,
  isWoltEzcountCandidate,
  isWoltEzcountFileB,
} from "@/lib/client-parsers/wolt-parser";
import {
  detectDocumentType,
  isPromotionalSubject,
  isCibusDailyReport,
  isHaatMonthlyReport,
  isReceiptDocument,
} from "@/lib/email/classify-document-type";
import { isRfc822Attachment, unwrapRfc822 } from "@/lib/email/unwrap-rfc822";
import {
  resolveFranchisee,
  isInactiveFranchiseeSkip,
  formatResolveFailure,
  type ResolveFranchiseeResult,
} from "@/lib/email/resolve-franchisee";
import { extractAndDownloadLinks } from "@/lib/email/download-links";
import { detectRecipientClientCodeFromPdf } from "@/lib/email/detect-invoice-recipient";
import { database } from "@/db";
import { franchisee, client } from "@/db/schema";
import { and, eq } from "drizzle-orm";
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

    // ─── Step 3d: Drop ezcount payment receipts ("קבלה NNNN מאת ...") ───
    // The franchisee issues both a "חשבונית מס" (the reconciled report) and a
    // "קבלה" (payment receipt) per period. The receipt has no distinguishing
    // keyword, so it fell through to the default client_report; when it arrived
    // first it grabbed the single (client, franchisee, period) report slot and
    // the overwrite guard then parked the real invoice as `failed`. Real
    // incident (Reut/מינה, June 2026): receipt 20007 (₪17,385.98) displaced tax
    // invoice 10052 (₪22,061) for HAAT / קינג קונג חורב. The receipt is not
    // used in reconciliation and its amount differs from the invoice, so drop
    // it on arrival. Client-independent: receipts are franchisee-issued via
    // ezcount regardless of platform. A combined "חשבונית מס/קבלה" is excluded.
    if (isReceiptDocument(subject)) {
      console.log(
        `[email-inbound] Skipping payment receipt: "${subject}"`
      );
      await finalizeSyncLog(syncLog.id, "completed", {
        messagesScanned: 1,
        documentsCreated: 0,
        duplicatesSkipped: 1,
        errorCount: 0,
        errorDetails: [
          `דולג: קבלת תשלום ("${subject}") — הדוח שנקלט הוא חשבונית המס של הזכיין`,
        ],
        ...diagnostics,
      });
      return NextResponse.json({
        received: true,
        skipped: true,
        reason: "payment_receipt",
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

      // ── Unwrap "Forward as attachment" emails (message/rfc822) ──
      // Outlook wraps each forwarded email as a message/rfc822 attachment
      // instead of carrying the original PDF/link. Those are not PDFs, so the
      // PDF filter below would drop them all and the email would fail with
      // "no attachments / no links" (real incident 2026-06-15: 3 March Tenbis
      // commission invoices forwarded by hadas@latableg.com). We download each
      // wrapped .eml, extract its inner PDF/Excel documents AND its inner body
      // (so the link-download path can recover link-based invoices), and
      // classify each by the INNER subject — the outer forward often has an
      // empty subject.
      const rfc822Attachments = email.attachments.filter(isRfc822Attachment);
      const directAttachments = email.attachments.filter(
        (a) => !isRfc822Attachment(a),
      );

      const extractedFiles: Array<{
        buffer: Buffer;
        fileName: string;
        documentType: "client_report" | "commission_invoice";
      }> = [];
      // Inner email bodies to scan for download links, each with the document
      // type inferred from its own subject.
      const innerLinkSources: Array<{
        body: string;
        keyPrefix: string;
        documentType: "client_report" | "commission_invoice";
      }> = [];

      for (let e = 0; e < rfc822Attachments.length; e++) {
        const eml = rfc822Attachments[e];
        const emlBuffer = await downloadAttachment(eml.downloadUrl);
        if (!emlBuffer) {
          errorCount++;
          errorDetails.push(`לא ניתן להוריד מייל מצורף: ${eml.filename}`);
          continue;
        }
        try {
          const unwrapped = await unwrapRfc822(emlBuffer);
          const innerType = detectDocumentType(
            unwrapped.subject,
            unwrapped.html || unwrapped.text || undefined,
          );
          for (const f of unwrapped.pdfFiles) {
            extractedFiles.push({ ...f, documentType: innerType });
          }
          const innerBody = `${unwrapped.html}\n${unwrapped.text}`;
          if (innerBody.trim()) {
            innerLinkSources.push({
              body: innerBody,
              keyPrefix: `emldl${e}_`,
              documentType: innerType,
            });
          }
          console.log(
            `[email-inbound] ${identifiedClient.clientCode}: unwrapped forwarded email "${eml.filename}" → subject="${unwrapped.subject}" type=${innerType}, ${unwrapped.pdfFiles.length} document(s)`,
          );
        } catch (err) {
          errorCount++;
          errorDetails.push(
            `כשל בפענוח מייל מצורף "${eml.filename}": ${err instanceof Error ? err.message : String(err)}`,
          );
        }
      }

      // Filter direct attachments to PDF/Excel only — skip inline images
      // (logo, icons). rfc822 wrappers are handled above, not here.
      const documentAttachments = directAttachments.filter(
        (a) =>
          a.contentType === "application/pdf" ||
          a.contentType === "application/vnd.openxmlformats-officedocument.spreadsheetml.sheet" ||
          a.contentType === "application/vnd.ms-excel" ||
          a.filename.endsWith(".pdf") ||
          a.filename.endsWith(".xlsx") ||
          a.filename.endsWith(".xls")
      );

      // Honest count: direct documents + PDFs extracted from forwarded emails.
      diagnostics.filteredAttachmentCount =
        documentAttachments.length + extractedFiles.length;

      // Shared context + counter merge for buffer-file processing (extracted
      // PDFs and link downloads both flow through processBufferFile).
      const bufferCtx: BufferFileContext = {
        identifiedClient,
        subject,
        from,
        emailReceivedAt: email.createdAt ? new Date(email.createdAt) : null,
        allFranchisees: allFranchisees as Franchisee[],
        inactiveFranchisees: inactiveFranchisees as Franchisee[],
        period,
        syncLogId: syncLog.id,
      };
      const mergeOutcome = (o: BufferFileOutcome) => {
        documentsCreated += o.created;
        duplicatesSkipped += o.duplicate;
        errorCount += o.errorCount;
        errorDetails.push(...o.errorDetails);
      };

      // Process PDFs extracted from forwarded (message/rfc822) emails.
      for (let j = 0; j < extractedFiles.length; j++) {
        const f = extractedFiles[j];
        mergeOutcome(
          await processBufferFile(
            {
              buffer: f.buffer,
              fileName: f.fileName,
              documentType: f.documentType,
              dedupKey: `${email_id}#eml${j}`,
            },
            bufferCtx,
          ),
        );
      }

      // Link-download path. Scan the OUTER body only when there are no direct
      // attachments (existing behavior for Mandrill/inline-link 10bis cover
      // emails), and ALWAYS scan the inner forwarded bodies when present
      // (link-based invoices forwarded as attachments).
      const linkSources: Array<{
        body: string;
        keyPrefix: string;
        documentType: "client_report" | "commission_invoice";
      }> = [];
      if (documentAttachments.length === 0) {
        // Keep the historical `#dl{i}` key prefix so re-deliveries stay
        // idempotent with already-processed cover emails.
        linkSources.push({
          body: email.html || email.text || "",
          keyPrefix: "dl",
          documentType,
        });
      }
      linkSources.push(...innerLinkSources);

      let downloadedLinkCount = 0;
      for (const src of linkSources) {
        const downloadedFiles = await extractAndDownloadLinks(
          src.body,
          identifiedClient.clientCode,
        );
        downloadedLinkCount += downloadedFiles.length;
        for (let i = 0; i < downloadedFiles.length; i++) {
          const file = downloadedFiles[i];
          mergeOutcome(
            await processBufferFile(
              {
                buffer: file.buffer,
                fileName: file.fileName,
                documentType: src.documentType,
                dedupKey: `${email_id}#${src.keyPrefix}${i}`,
              },
              bufferCtx,
            ),
          );
        }
      }

      // Nothing found across ANY channel (direct docs, extracted forwarded
      // docs, link downloads) → record the failure + body excerpt.
      if (
        documentAttachments.length === 0 &&
        extractedFiles.length === 0 &&
        downloadedLinkCount === 0
      ) {
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
        // Re-route by the invoice's actual recipient ("לכבוד") — forwarded
        // ezcount "[העתק]" copies (with PDFs attached) arrive on the
        // MISHLOCHA channel even when the invoice was issued to Haat.
        const fileClient = await resolveFileClient(
          identifiedClient,
          buffer,
          attachmentDocumentType,
          attachment.filename,
          errorDetails,
        );
        const franchiseeMatch = await resolveFranchisee(
          buffer,
          attachment.contentType,
          fileClient.parserCode,
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
            `[email-inbound] ${fileClient.clientCode}: processing "${attachment.filename}" as ${effectiveDocumentType}`
          );

          attResult = await processClientDocument({
            buffer,
            fileName: attachment.filename,
            mimeType: attachment.contentType,
            clientId: fileClient.clientId,
            parserCode: fileClient.parserCode,
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
          clientId: fileClient.clientId,
          clientCode: fileClient.clientCode,
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


/** Minimal client-identity shape shared by the channel client and per-file overrides. */
interface FileClientIdentity {
  clientId: string;
  clientCode: string;
  parserCode: string;
}

/**
 * Per-FILE client resolution. The channel-level client comes from
 * to-address/sender (identifyClientFromEmail), but ezcount "[העתק]" copy
 * emails all arrive at mishlocha@inbound regardless of who the invoice
 * was issued to — each franchisee runs ONE ezcount sequence that serves
 * both Mishloha and Haat. May 2026: חורב's Haat-bound invoice 10051
 * landed in (and overwrote) its Mishloha report slot this way.
 *
 * So for client_report files arriving on the MISHLOCHA channel we sniff
 * the actual recipient from the PDF's "לכבוד" line and re-route the file
 * to that client. Detection failure (image-only PDF etc.) keeps the
 * channel client — the processor's overwrite guard still prevents data
 * loss in that case.
 */
async function resolveFileClient(
  channelClient: FileClientIdentity,
  buffer: Buffer,
  documentType: "client_report" | "commission_invoice",
  fileName: string,
  errorDetails: string[],
): Promise<FileClientIdentity> {
  if (channelClient.clientCode.toUpperCase() !== "MISHLOCHA") {
    return channelClient;
  }
  // Commission invoices on this channel are issued BY Mishloha to the
  // franchisee — recipient is the franchisee, nothing to re-route.
  if (documentType !== "client_report") {
    return channelClient;
  }

  const recipientCode = await detectRecipientClientCodeFromPdf(buffer);
  if (!recipientCode || recipientCode === channelClient.clientCode.toUpperCase()) {
    return channelClient;
  }

  const [target] = await database
    .select({
      id: client.id,
      code: client.code,
      parserCode: client.parserCode,
    })
    .from(client)
    .where(and(eq(client.isActive, true), eq(client.code, recipientCode)))
    .limit(1);
  if (!target) {
    console.warn(
      `[email-inbound] recipient sniff found "${recipientCode}" for "${fileName}" but no active client with that code — keeping ${channelClient.clientCode}`,
    );
    return channelClient;
  }

  console.log(
    `[email-inbound] Re-routed "${fileName}" by invoice recipient: ${channelClient.clientCode} → ${recipientCode}`,
  );
  errorDetails.push(
    `נותב מחדש לפי "לכבוד": "${fileName}" → ${recipientCode} (חשבונית שהזכיין הוציא ל-${recipientCode} והגיעה בערוץ משלוחה)`,
  );
  return {
    clientId: target.id,
    clientCode: target.code ?? recipientCode,
    parserCode: target.parserCode ?? target.code ?? recipientCode,
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
    // Structured marker for the overwrite-guard conflict (a real document was
    // received but its (client, franchisee, period) slot was already taken by a
    // different email). The daily review digest keys on this to surface the
    // DANGEROUS parked rows — where the reconciled figure may be wrong — as
    // their own category, instead of relying on the (translatable) failureReason
    // text. See cron/inbound-review-summary.
    let resolutionStrategy: string | null = null;
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
        if (args.processResult?.skippedConflict) {
          resolutionStrategy = "overwrite_conflict";
        }
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
      resolutionStrategy,
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

/** Per-channel counters returned by processBufferFile, merged by the caller. */
interface BufferFileOutcome {
  created: number;
  duplicate: number;
  errorCount: number;
  errorDetails: string[];
}

/** Shared email-level context for processing already-downloaded PDF buffers. */
interface BufferFileContext {
  identifiedClient: FileClientIdentity;
  subject: string;
  from: string;
  emailReceivedAt: Date | null;
  allFranchisees: Franchisee[];
  inactiveFranchisees: Franchisee[];
  period: { month: number; year: number };
  syncLogId: string;
}

/**
 * Process one already-downloaded PDF buffer through the full
 * resolve→commit→record pipeline. Shared by (a) PDFs extracted from forwarded
 * message/rfc822 attachments and (b) link-downloaded files.
 *
 * Each call MUST pass a DISTINCT `dedupKey`: gmail_message_id has a UNIQUE
 * index, so reusing a key silently rejects the 2nd+ file as a duplicate.
 * Returns counter deltas; never throws — failures are folded into the outcome.
 */
async function processBufferFile(
  file: {
    buffer: Buffer;
    fileName: string;
    dedupKey: string;
    documentType: "client_report" | "commission_invoice";
  },
  ctx: BufferFileContext,
): Promise<BufferFileOutcome> {
  const outcome: BufferFileOutcome = {
    created: 0,
    duplicate: 0,
    errorCount: 0,
    errorDetails: [],
  };

  // Re-route by the invoice's actual recipient ("לכבוד") — ezcount "[העתק]"
  // copies arrive on the MISHLOCHA channel even when the franchisee issued the
  // invoice to Haat (one ezcount sequence serves both clients).
  const fileClient = await resolveFileClient(
    ctx.identifiedClient,
    file.buffer,
    file.documentType,
    file.fileName,
    outcome.errorDetails,
  );
  const franchiseeMatch = await resolveFranchisee(
    file.buffer,
    "application/pdf",
    fileClient.parserCode,
    ctx.subject,
    ctx.allFranchisees,
    file.fileName,
    file.documentType,
    ctx.inactiveFranchisees,
  );

  if (isInactiveFranchiseeSkip(franchiseeMatch)) {
    outcome.duplicate++;
    outcome.errorDetails.push(
      `דולג: "${file.fileName}" לזכיין סגור "${franchiseeMatch.inactiveFranchiseeName}"`,
    );
    return outcome;
  }

  let result: ProcessClientDocumentResult | null = null;
  if (!franchiseeMatch.ok) {
    outcome.errorCount++;
    outcome.errorDetails.push(formatResolveFailure(franchiseeMatch, ctx.subject));
  } else {
    result = await processClientDocument({
      buffer: file.buffer,
      fileName: file.fileName,
      mimeType: "application/pdf",
      clientId: fileClient.clientId,
      parserCode: fileClient.parserCode,
      franchiseeId: franchiseeMatch.franchiseeId,
      periodMonth: ctx.period.month,
      periodYear: ctx.period.year,
      documentType: file.documentType,
      source: "gmail_fetch",
      gmailMessageId: file.dedupKey,
    });

    if (result.skippedDuplicate) {
      outcome.duplicate++;
    } else if (result.success) {
      outcome.created++;
    } else {
      outcome.errorCount++;
      outcome.errorDetails.push(
        `${file.fileName}: ${result.error ?? "שגיאה בעיבוד"}`,
      );
    }
  }

  await recordInboundReviewOutcome({
    syncLogId: ctx.syncLogId,
    emailId: file.dedupKey,
    emailSubject: ctx.subject,
    emailFrom: ctx.from,
    emailReceivedAt: ctx.emailReceivedAt,
    clientId: fileClient.clientId,
    clientCode: fileClient.clientCode,
    documentType: file.documentType,
    franchiseeMatch,
    processResult: result,
    fileContext: {
      buffer: file.buffer,
      fileName: file.fileName,
      mimeType: "application/pdf",
    },
    periodMonth: ctx.period.month,
    periodYear: ctx.period.year,
  });

  return outcome;
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

  // Candidate ezcount PDFs \u2014 any PDF that is not a report/netting doc.
  // See isWoltEzcountCandidate for why the filename must not be trusted.
  const ezcountCandidates = attachments.filter(isWoltEzcountCandidate);

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
