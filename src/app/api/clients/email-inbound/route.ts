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
import { getClientParser } from "@/lib/client-parsers";
import {
  createSyncLogEntry,
  updateSyncLogEntry,
} from "@/data-access/gmail-sync";
import { matchFranchiseeName } from "@/lib/franchisee-matcher";
import { database } from "@/db";
import { franchisee } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { Franchisee } from "@/db/schema";

/** Client codes that parse from email body instead of attachments */
const BODY_BASED_CLIENTS = new Set(["CIBUS"]);

export async function POST(request: NextRequest) {
  // Create sync log early
  const syncLog = await createSyncLogEntry();
  let messagesScanned = 0;
  let documentsCreated = 0;
  let duplicatesSkipped = 0;
  let errorCount = 0;
  const errorDetails: string[] = [];

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

    console.log(
      `[email-inbound] Received email from ${from} to ${to.join(",")} subject: "${subject}"`
    );

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
      });
      return NextResponse.json({ received: true, error: msg });
    }

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
      });
      return NextResponse.json({ received: true, error: msg });
    }

    // ─── Step 5: Resolve period ────────────────────────────────────────
    const period = resolvePeriod(subject, email.createdAt);

    // ─── Step 6: Load franchisees for matching ─────────────────────────
    const allFranchisees = await database
      .select()
      .from(franchisee)
      .where(eq(franchisee.isActive, true));

    // ─── Step 7: Process — body-based or attachment-based ──────────────
    const isBodyBased = BODY_BASED_CLIENTS.has(
      identifiedClient.clientCode.toUpperCase()
    );

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
          allFranchisees as Franchisee[]
        );

        if (!franchiseeMatch) {
          const msg = `לא זוהה זכיין מהמסמך או מנושא המייל: "${subject}"`;
          errorCount++;
          errorDetails.push(msg);
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
            documentType: "client_report",
            source: "gmail_fetch",
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

      // If no attachments, try to extract download links from email body (e.g. Tenbis)
      if (email.attachments.length === 0) {
        const downloadedFiles = await extractAndDownloadLinks(
          email.html || email.text || "",
          identifiedClient.clientCode
        );

        if (downloadedFiles.length === 0) {
          const msg = `מייל ${email_id} ללא קבצים מצורפים ולא נמצאו לינקים להורדה`;
          errorCount++;
          errorDetails.push(msg);
        }

        for (const file of downloadedFiles) {
          const franchiseeMatch = await resolveFranchisee(
            file.buffer,
            "application/pdf",
            identifiedClient.parserCode,
            subject,
            allFranchisees as Franchisee[],
            file.fileName
          );

          if (!franchiseeMatch) {
            const msg = `לא זוהה זכיין מהמסמך או מנושא המייל: "${subject}"`;
            errorCount++;
            errorDetails.push(msg);
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
            documentType: "client_report",
            source: "gmail_fetch",
            gmailMessageId: email_id,
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

      // Filter attachments: prefer sales_report for Wolt, skip commission/netting docs
      const filteredAttachments = filterAttachments(
        email.attachments,
        identifiedClient.clientCode
      );

      for (const attachment of filteredAttachments) {
        const buffer = await downloadAttachment(attachment.downloadUrl);
        if (!buffer) {
          errorCount++;
          errorDetails.push(`לא ניתן להוריד קובץ: ${attachment.filename}`);
          continue;
        }

        // Resolve franchisee: parse document first, fall back to filename/subject
        const franchiseeMatch = await resolveFranchisee(
          buffer,
          attachment.contentType,
          identifiedClient.parserCode,
          subject,
          allFranchisees as Franchisee[],
          attachment.filename
        );

        if (!franchiseeMatch) {
          const msg = `לא זוהה זכיין מהמסמך או מנושא המייל: "${subject}"`;
          errorCount++;
          errorDetails.push(msg);
          continue;
        }

        const result = await processClientDocument({
          buffer,
          fileName: attachment.filename,
          mimeType: attachment.contentType,
          clientId: identifiedClient.clientId,
          parserCode: identifiedClient.parserCode,
          franchiseeId: franchiseeMatch.franchiseeId,
          periodMonth: period.month,
          periodYear: period.year,
          documentType: "client_report",
          source: "gmail_fetch",
          gmailMessageId: email_id,
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
async function resolveFranchisee(
  buffer: Buffer,
  mimeType: string,
  parserCode: string,
  subject: string,
  franchisees: Franchisee[],
  attachmentFilename?: string
): Promise<{ franchiseeId: string; franchiseeName: string } | null> {
  // Strategy 1: Parse document and use extracted franchisee name
  const parser = getClientParser(parserCode);
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
          console.log(
            `[email-inbound] Matched franchisee from document content: "${parseResult.data.franchiseeName}" → "${match.matchedFranchisee.name}"`
          );
          return {
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
      return filenameMatch;
    }
  }

  // Strategy 3: Fall back to subject matching
  return matchFranchiseeFromSubject(subject, franchisees);
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

  // Split on double underscore — Wolt uses "{branch}__sales_report__..."
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

/**
 * Filter attachments to pick the most relevant document per client.
 *
 * Wolt emails contain 4 PDFs: 2 invoices, 1 netting report, 1 sales report.
 * For reconciliation against Tabit we only need the sales_report.
 */
function filterAttachments(
  attachments: Array<{ filename: string; contentType: string; downloadUrl: string }>,
  clientCode: string
): Array<{ filename: string; contentType: string; downloadUrl: string }> {
  if (clientCode === "WOLT" && attachments.length > 1) {
    // Prefer sales_report — it contains the total sales we need for reconciliation
    const salesReport = attachments.find((a) =>
      a.filename.toLowerCase().includes("sales_report")
    );
    if (salesReport) {
      console.log(
        `[email-inbound] Wolt: selected sales_report from ${attachments.length} attachments: ${salesReport.filename}`
      );
      return [salesReport];
    }

    // Fallback: pick the largest PDF (sales report is typically much larger)
    const sorted = [...attachments]
      .filter((a) => a.contentType === "application/pdf")
      .sort((a, b) => {
        // Can't sort by size since it's not in the type, but filename length as rough heuristic
        return 0;
      });
    if (sorted.length > 0) {
      console.log(
        `[email-inbound] Wolt: no sales_report found, using first PDF: ${sorted[0].filename}`
      );
      return [sorted[0]];
    }
  }

  // For other clients, process all attachments
  return attachments;
}

/**
 * Extract download links from email HTML body and download the PDFs.
 * Supports:
 * - Tenbis: Mandrill tracking links wrapping cdn.10bis.co.il PDF URLs
 * - Direct PDF links
 */
async function extractAndDownloadLinks(
  htmlBody: string,
  clientCode: string
): Promise<Array<{ buffer: Buffer; fileName: string }>> {
  const results: Array<{ buffer: Buffer; fileName: string }> = [];

  // Pattern 1: Tenbis — Mandrill tracking links with base64-encoded target URL
  // The base64 `p` param contains JSON with the actual cdn.10bis.co.il URL
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
  }

  // Pattern 2: Direct PDF links (generic fallback)
  if (results.length === 0) {
    const directLinks = htmlBody.match(
      /https?:\/\/[^\s"'<>]+\.pdf/gi
    ) || [];

    for (const pdfUrl of directLinks) {
      try {
        console.log(`[email-inbound] Downloading direct PDF: ${pdfUrl}`);
        const response = await fetch(pdfUrl);
        if (!response.ok) continue;

        const arrayBuffer = await response.arrayBuffer();
        const buffer = Buffer.from(arrayBuffer);
        const fileName = pdfUrl.split("/").pop() ?? "report.pdf";

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
  });
}
