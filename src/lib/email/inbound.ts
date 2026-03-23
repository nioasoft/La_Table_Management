/**
 * Resend Inbound Email Processing
 *
 * Handles incoming client emails via Resend Inbound webhooks.
 * Identifies the client, fetches email content/attachments, and routes
 * to the appropriate document processing pipeline.
 */

import { Resend } from "resend";
import { database } from "@/db";
import { client } from "@/db/schema";
import { eq, and } from "drizzle-orm";

// ============================================================================
// RESEND CLIENT
// ============================================================================

const resend = process.env.RESEND_API_KEY
  ? new Resend(process.env.RESEND_API_KEY)
  : null;

// ============================================================================
// TYPES
// ============================================================================

/** Webhook payload for email.received event from Resend */
export interface ResendInboundWebhookPayload {
  type: "email.received";
  created_at: string;
  data: {
    email_id: string;
    from: string;
    to: string[];
    subject: string;
    created_at: string;
  };
}

/** Fetched inbound email with full content */
export interface InboundEmail {
  id: string;
  from: string;
  to: string[];
  subject: string;
  html: string | null;
  text: string | null;
  headers: Record<string, string>;
  attachments: InboundAttachment[];
  createdAt: string;
}

/** Attachment metadata from the fetched email */
export interface InboundAttachment {
  id: string;
  filename: string;
  size: number;
  contentType: string;
  downloadUrl: string;
}

/** Result of client identification */
export interface IdentifiedClient {
  clientId: string;
  clientCode: string;
  parserCode: string;
  identifiedBy: "to_address" | "from_address";
}

// ============================================================================
// HEBREW MONTH PARSING (shared with tabit-parser)
// ============================================================================

const HEBREW_MONTHS: Record<string, number> = {
  ינואר: 1,
  פברואר: 2,
  מרץ: 3,
  אפריל: 4,
  מאי: 5,
  יוני: 6,
  יולי: 7,
  אוגוסט: 8,
  ספטמבר: 9,
  אוקטובר: 10,
  נובמבר: 11,
  דצמבר: 12,
};

const ENGLISH_MONTHS: Record<string, number> = {
  january: 1,
  february: 2,
  march: 3,
  april: 4,
  may: 5,
  june: 6,
  july: 7,
  august: 8,
  september: 9,
  october: 10,
  november: 11,
  december: 12,
};

// ============================================================================
// EMAIL FETCHING
// ============================================================================

/**
 * Fetch a received email from Resend Inbound API.
 * Returns the full email including html/text body and attachment metadata.
 */
export async function fetchInboundEmail(
  emailId: string
): Promise<InboundEmail | null> {
  if (!resend) {
    console.error("Resend API key not configured");
    return null;
  }

  const { data, error } = await resend.emails.receiving.get(emailId);
  if (error || !data) {
    console.error("Failed to fetch inbound email:", error);
    return null;
  }

  // For each attachment, fetch the download URL via the attachments API
  const attachments: InboundAttachment[] = [];
  for (const att of data.attachments ?? []) {
    const attResult = await resend.emails.receiving.attachments.get({
      emailId: data.id,
      id: att.id,
    });
    if (attResult.data) {
      attachments.push({
        id: att.id,
        filename: att.filename ?? "attachment",
        size: att.size,
        contentType: att.content_type,
        downloadUrl: attResult.data.download_url,
      });
    } else {
      console.warn(
        `Failed to get download URL for attachment ${att.id}:`,
        attResult.error
      );
    }
  }

  return {
    id: data.id,
    from: data.from,
    to: data.to,
    subject: data.subject,
    html: data.html,
    text: data.text,
    headers: data.headers,
    createdAt: data.created_at,
    attachments,
  };
}

/**
 * Download an attachment from Resend.
 * Uses the attachment's download_url which is valid for 7 days.
 */
export async function downloadAttachment(
  downloadUrl: string
): Promise<Buffer | null> {
  try {
    const response = await fetch(downloadUrl);
    if (!response.ok) {
      console.error(
        `Failed to download attachment: ${response.status} ${response.statusText}`
      );
      return null;
    }
    const arrayBuffer = await response.arrayBuffer();
    return Buffer.from(arrayBuffer);
  } catch (error) {
    console.error("Error downloading attachment:", error);
    return null;
  }
}

// ============================================================================
// CLIENT IDENTIFICATION
// ============================================================================

/**
 * Identify which client sent the email.
 *
 * Priority:
 * 1. `to` address local part → match against client.code (case-insensitive)
 *    e.g. cibus@inbound.latable.co.il → CIBUS
 * 2. `from` address → match against client.gmailSenderEmail
 */
export async function identifyClientFromEmail(
  to: string[],
  from: string,
  _subject: string
): Promise<IdentifiedClient | null> {
  // Strategy 1: Match to-address local part against client code
  for (const toAddr of to) {
    const localPart = toAddr.split("@")[0]?.toUpperCase();
    if (!localPart) continue;

    const [matched] = await database
      .select({
        id: client.id,
        code: client.code,
        parserCode: client.parserCode,
      })
      .from(client)
      .where(
        and(
          eq(client.isActive, true),
          eq(client.code, localPart)
        )
      )
      .limit(1);

    if (matched) {
      return {
        clientId: matched.id,
        clientCode: matched.code ?? localPart,
        parserCode: matched.parserCode ?? matched.code ?? localPart,
        identifiedBy: "to_address",
      };
    }
  }

  // Strategy 2: Match from-address against client.gmailSenderEmail
  const fromLower = from.toLowerCase().trim();
  // Extract email from "Name <email>" format
  const emailMatch = fromLower.match(/<([^>]+)>/);
  const fromEmail = emailMatch ? emailMatch[1] : fromLower;

  const clients = await database
    .select({
      id: client.id,
      code: client.code,
      parserCode: client.parserCode,
      gmailSenderEmail: client.gmailSenderEmail,
    })
    .from(client)
    .where(eq(client.isActive, true));

  for (const c of clients) {
    if (!c.gmailSenderEmail) continue;
    // Support wildcard matching: *@domain.com
    const senderPattern = c.gmailSenderEmail.toLowerCase().trim();
    if (senderPattern.startsWith("*@")) {
      const domain = senderPattern.slice(2);
      if (fromEmail.endsWith(`@${domain}`)) {
        return {
          clientId: c.id,
          clientCode: c.code ?? "",
          parserCode: c.parserCode ?? c.code ?? "",
          identifiedBy: "from_address",
        };
      }
    } else if (fromEmail === senderPattern) {
      return {
        clientId: c.id,
        clientCode: c.code ?? "",
        parserCode: c.parserCode ?? c.code ?? "",
        identifiedBy: "from_address",
      };
    }
  }

  return null;
}

// ============================================================================
// PERIOD EXTRACTION
// ============================================================================

/**
 * Extract period (month/year) from an email subject line.
 *
 * Handles patterns like:
 * - "ריכוז חיוב חודשי - פברואר 2026"
 * - "דוח חודשי 02/2026"
 * - "Monthly report - February 2026"
 */
export function extractPeriodFromSubject(
  subject: string
): { month: number; year: number } | null {
  if (!subject) return null;

  // Pattern 1: Hebrew month name + year
  for (const [name, month] of Object.entries(HEBREW_MONTHS)) {
    if (subject.includes(name)) {
      const yearMatch = subject.match(/\b(20\d{2})\b/);
      if (yearMatch) {
        return { month, year: parseInt(yearMatch[1], 10) };
      }
    }
  }

  // Pattern 2: English month name + year
  const subjectLower = subject.toLowerCase();
  for (const [name, month] of Object.entries(ENGLISH_MONTHS)) {
    if (subjectLower.includes(name)) {
      const yearMatch = subject.match(/\b(20\d{2})\b/);
      if (yearMatch) {
        return { month, year: parseInt(yearMatch[1], 10) };
      }
    }
  }

  // Pattern 3: MM/YYYY or MM-YYYY
  const slashMatch = subject.match(/\b(\d{1,2})[/-](20\d{2})\b/);
  if (slashMatch) {
    const month = parseInt(slashMatch[1], 10);
    const year = parseInt(slashMatch[2], 10);
    if (month >= 1 && month <= 12) {
      return { month, year };
    }
  }

  // Pattern 4: YYYY-MM (ISO prefix)
  const isoMatch = subject.match(/\b(20\d{2})[/-](\d{1,2})\b/);
  if (isoMatch) {
    const year = parseInt(isoMatch[1], 10);
    const month = parseInt(isoMatch[2], 10);
    if (month >= 1 && month <= 12) {
      return { month, year };
    }
  }

  return null;
}

/**
 * Determine the most likely period from email metadata.
 * Falls back to previous month from email date.
 */
export function resolvePeriod(
  subject: string,
  emailDate: string | null
): { month: number; year: number } {
  // Try subject first
  const fromSubject = extractPeriodFromSubject(subject);
  if (fromSubject) return fromSubject;

  // Fallback: previous month from email date or current date
  const referenceDate = emailDate ? new Date(emailDate) : new Date();
  const prevMonth = new Date(
    referenceDate.getFullYear(),
    referenceDate.getMonth() - 1,
    1
  );
  return {
    month: prevMonth.getMonth() + 1,
    year: prevMonth.getFullYear(),
  };
}
