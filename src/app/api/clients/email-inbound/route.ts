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
import { database } from "@/db";
import { franchisee } from "@/db/schema";
import { eq } from "drizzle-orm";
import type { Franchisee } from "@/db/schema";

/** Client codes that parse from email body instead of attachments */
const BODY_BASED_CLIENTS = new Set(["CIBUS"]);

/** Keywords in email subject that indicate a commission invoice (not a client report) */
const INVOICE_SUBJECT_KEYWORDS = [
  "חשבונית מס",
  "חשבונית עמלה",
  "חשבונית מס/קבלה",
  // HAAT Hebrew subject — "FW: חשבונית מרכזת" (centralized invoice). HAAT
  // sends one consolidated invoice per franchisee per period and labels it
  // "מרכזת". This subject is reliable enough to classify as commission_invoice.
  "חשבונית מרכזת",
  "tax invoice",
  "commission invoice",
  // HAAT and other ezcount-issued invoices use generic English subjects:
  //   "FW: EasyCount Invoice for HAAT"
  //   "EasyCount Invoice for ..."
  // The vendor name varies but the "EasyCount Invoice" / "ezcount Invoice"
  // signature is reliable.
  "easycount invoice",
  "ezcount invoice",
];

/**
 * Detect document type from email subject.
 * Returns "commission_invoice" if subject contains invoice keywords,
 * otherwise "client_report".
 */
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
          allFranchisees as Franchisee[],
          undefined,
          documentType
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
            documentType,
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
        }

        for (const file of downloadedFiles) {
          const franchiseeMatch = await resolveFranchisee(
            file.buffer,
            "application/pdf",
            identifiedClient.parserCode,
            subject,
            allFranchisees as Franchisee[],
            file.fileName,
            documentType
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
            documentType,
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

        if (!franchiseeMatch) {
          const msg = `לא זוהה זכיין מהמסמך או מנושא המייל: "${subject}"`;
          errorCount++;
          errorDetails.push(msg);
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
  attachmentFilename?: string,
  documentType: "client_report" | "commission_invoice" = "client_report"
): Promise<{ franchiseeId: string; franchiseeName: string } | null> {
  // Strategy 1: Parse document and use extracted franchisee name.
  // Critical: commission invoices (Mishloha, Wolt, etc.) have a SEPARATE
  // parser registered under getInvoiceParser — the sales/report parser has
  // different franchisee-extraction logic (issuer vs recipient).
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

  // Pattern 3: Direct PDF links (generic fallback)
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
