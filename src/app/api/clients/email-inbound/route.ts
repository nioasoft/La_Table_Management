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
import { matchFranchiseeName } from "@/lib/franchisee-matcher";
import { isWoltEzcountFileB } from "@/lib/client-parsers/wolt-parser";
import { detectDocumentType } from "@/lib/email/classify-document-type";
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

    // ─── Step 5: Resolve period ────────────────────────────────────────
    const period = resolvePeriod(subject, email.createdAt);

    // ─── Step 5b: Detect document type from subject ─────────────────────
    const documentType = detectDocumentType(subject);
    if (documentType === "commission_invoice") {
      console.log(`[email-inbound] Detected commission invoice from subject: "${subject}"`);
    }

    // ─── Step 6: Load franchisees for matching ─────────────────────────
    const allFranchisees = await database
      .select()
      .from(franchisee)
      .where(eq(franchisee.isActive, true));

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
          documentType
        );

        if (!franchiseeMatch.ok) {
          errorCount++;
          errorDetails.push(formatResolveFailure(franchiseeMatch, subject));
        } else {
          const result = await processClientDocument({
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

          if (result.skippedDuplicate) {
            duplicatesSkipped++;
          } else if (result.success) {
            documentsCreated++;
          } else {
            errorCount++;
            errorDetails.push(result.error ?? "שגיאה בעיבוד");
          }
        }
      }
    } else {
      // ── Attachment-based client ──

      // Capture every raw attachment into diagnostics — written to
      // gmail_sync_log.raw_attachments so we can see what Resend handed us
      // BEFORE any filtering, even when nothing makes it through to a
      // client_document record.
      diagnostics.rawAttachmentCount = email.attachments.length;
      diagnostics.rawAttachments = email.attachments.map((a) => ({
        filename: a.filename,
        contentType: a.contentType,
        size: a.size,
      }));

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
            documentType
          );

          if (!franchiseeMatch.ok) {
            errorCount++;
            errorDetails.push(formatResolveFailure(franchiseeMatch, subject));
            continue;
          }

          const result = await processClientDocument({
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

          if (result.skippedDuplicate) {
            duplicatesSkipped++;
          } else if (result.success) {
            documentsCreated++;
          } else {
            errorCount++;
            errorDetails.push(
              `${file.fileName}: ${result.error ?? "שגיאה בעיבוד"}`
            );
          }
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
          attachmentDocumentType
        );

        if (!franchiseeMatch.ok) {
          errorCount++;
          errorDetails.push(formatResolveFailure(franchiseeMatch, subject));
          continue;
        }

        console.log(
          `[email-inbound] ${identifiedClient.clientCode}: processing "${attachment.filename}" as ${attachment.documentType ?? documentType}`
        );

        const result = await processClientDocument({
          buffer,
          fileName: attachment.filename,
          mimeType: attachment.contentType,
          clientId: identifiedClient.clientId,
          parserCode: identifiedClient.parserCode,
          franchiseeId: franchiseeMatch.franchiseeId,
          periodMonth: period.month,
          periodYear: period.year,
          documentType: attachment.documentType ?? documentType,
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

        if (result.skippedDuplicate) {
          duplicatesSkipped++;
        } else if (result.success) {
          documentsCreated++;
        } else {
          errorCount++;
          errorDetails.push(
            `${attachment.filename}: ${result.error ?? "שגיאה בעיבוד"}`
          );
        }
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
 * Resolve franchisee using multiple strategies, in order:
 *
 * 1. Parse document → extract franchiseeName → fuzzy match
 * 2. Attachment filename (e.g. Wolt: "קינג קונג חדרה הכשר__sales_report__...")
 * 3. Email subject matching
 */
type ResolveFranchiseeResult =
  | { ok: true; franchiseeId: string; franchiseeName: string }
  | {
      ok: false;
      // Diagnostics: what was tried and why it failed. Surfaced into
      // gmail_sync_log.error_details so we can debug without asking the
      // user to forward the original email each time.
      extractedName?: string;
      filenameAttempt?: string;
      reason: string;
    };

async function resolveFranchisee(
  buffer: Buffer,
  mimeType: string,
  parserCode: string,
  subject: string,
  franchisees: Franchisee[],
  attachmentFilename?: string,
  documentType: "client_report" | "commission_invoice" = "client_report"
): Promise<ResolveFranchiseeResult> {
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
        const match = matchFranchiseeName(
          extractedName,
          franchisees,
          { minConfidence: 0.6 }
        );
        if (match.matchedFranchisee) {
          console.log(
            `[email-inbound] Matched franchisee from document content: "${extractedName}" → "${match.matchedFranchisee.name}"`
          );
          return {
            ok: true,
            franchiseeId: match.matchedFranchisee.id,
            franchiseeName: match.matchedFranchisee.name,
          };
        }
      }
    } catch (err) {
      console.warn("[email-inbound] Pre-parse for franchisee extraction failed:", err);
    }
  }

  // Strategy 2: Extract branch name from attachment filename
  // Wolt filenames: "{branch}__sales_report__monthly__{start}__{end}.pdf"
  if (attachmentFilename) {
    const filenameMatch = matchFranchiseeFromFilename(attachmentFilename, franchisees);
    if (filenameMatch) {
      console.log(
        `[email-inbound] Matched franchisee from filename: "${attachmentFilename}" → "${filenameMatch.franchiseeName}"`
      );
      return { ok: true, ...filenameMatch };
    }
  }

  // Strategy 3: Fall back to subject matching
  const subjectMatch = matchFranchiseeFromSubject(subject, franchisees);
  if (subjectMatch) {
    return { ok: true, ...subjectMatch };
  }

  return {
    ok: false,
    extractedName,
    filenameAttempt: attachmentFilename,
    reason: extractedName
      ? `Extracted "${extractedName}" but no franchisee alias matched (≥0.6 confidence)`
      : "Parser did not extract a franchisee name; filename and subject also did not match",
  };
}

function formatResolveFailure(
  failure: Extract<ResolveFranchiseeResult, { ok: false }>,
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
  franchisees: Franchisee[]
): { franchiseeId: string; franchiseeName: string } | null {
  if (!filename || franchisees.length === 0) return null;

  // Strip extension
  const withoutExt = filename.replace(/\.[^.]+$/, "");

  // Split on double underscore — Wolt legacy: "{branch}__sales_report__..."
  const doubleUnderscoreParts = withoutExt.split("__");
  if (doubleUnderscoreParts.length > 1) {
    const branchPart = doubleUnderscoreParts[0].trim();
    if (branchPart.length >= 3) {
      const result = matchFranchiseeName(branchPart, franchisees, {
        minConfidence: 0.6,
      });
      if (result.matchedFranchisee) {
        return {
          franchiseeId: result.matchedFranchisee.id,
          franchiseeName: result.matchedFranchisee.name,
        };
      }
    }
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
    const candidate = hebrewTokens.join(" ").trim();
    if (candidate.length >= 3) {
      const result = matchFranchiseeName(candidate, franchisees, {
        minConfidence: 0.6,
      });
      if (result.matchedFranchisee) {
        return {
          franchiseeId: result.matchedFranchisee.id,
          franchiseeName: result.matchedFranchisee.name,
        };
      }
    }
  }

  // Also try the full filename (minus extension) for less structured names
  const cleaned = withoutExt
    .replace(/[_-]+/g, " ")
    .replace(/\d{4}[-/]\d{2}[-/]\d{2}/g, "") // remove dates
    .replace(/\b(sales|report|monthly|invoice|חשבונית|דוח)\b/gi, "")
    .replace(/\s+/g, " ")
    .trim();

  if (cleaned.length >= 3) {
    const result = matchFranchiseeName(cleaned, franchisees, {
      minConfidence: 0.7,
    });
    if (result.matchedFranchisee) {
      return {
        franchiseeId: result.matchedFranchisee.id,
        franchiseeName: result.matchedFranchisee.name,
      };
    }
  }

  return null;
}

/**
 * Try to match a franchisee from the email subject.
 * Removes common prefixes/patterns to isolate the branch name.
 */
function matchFranchiseeFromSubject(
  subject: string,
  franchisees: Franchisee[]
): { franchiseeId: string; franchiseeName: string } | null {
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
    if (result.matchedFranchisee) {
      return {
        franchiseeId: result.matchedFranchisee.id,
        franchiseeName: result.matchedFranchisee.name,
      };
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

  // Peek content of each candidate to split into File A / File B
  let fileA: Attachment | null = null;
  let fileB: Attachment | null = null;

  for (const candidate of ezcountCandidates) {
    const buf = await download(candidate.downloadUrl);
    if (!buf) continue;
    const isFileB = await isWoltEzcountFileB(buf);
    if (isFileB && !fileB) {
      fileB = candidate;
      console.log(
        `[email-inbound] Wolt: matched File B (sales invoice to Wolt Enterprises): ${candidate.filename}`
      );
    } else if (!isFileB && !fileA) {
      fileA = candidate;
      console.log(
        `[email-inbound] Wolt: matched File A (commission invoice from Wolt): ${candidate.filename}`
      );
    }
    if (fileA && fileB) break;
  }

  const results: Attachment[] = [];
  if (fileA) {
    results.push({ ...fileA, documentType: "commission_invoice" });
  }
  if (fileB) {
    results.push({ ...fileB, documentType: "client_report" });
  } else {
    // Defensive fallback for the client_report side only:
    // sales_report (no netAmount will be extracted)
    const salesReport = attachments.find((a) =>
      a.filename.toLowerCase().includes("sales_report")
    );
    if (salesReport) {
      console.warn(
        `[email-inbound] Wolt: no File B found among ${ezcountCandidates.length} ezcount PDFs — falling back to sales_report: ${salesReport.filename}`
      );
      results.push({ ...salesReport, documentType: "client_report" });
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

        // Only download report PDFs (skip refund reports)
        if (!pdfUrl.includes("cdn.10bis.co.il") || !pdfUrl.endsWith(".pdf")) continue;
        if (pdfUrl.includes("refund_")) continue;

        console.log(`[email-inbound] Tenbis: downloading PDF from ${pdfUrl}`);
        const response = await fetch(pdfUrl);
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
