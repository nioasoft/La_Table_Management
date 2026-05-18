import { NextRequest, NextResponse } from "next/server";
import { database } from "@/db";
import {
  fileRequest,
  uploadedFile,
  supplierFileUpload,
  contact,
  type FileRequest,
} from "@/db/schema";
import { eq, and, gte, inArray } from "drizzle-orm";
import { getPeriodByKey } from "@/lib/settlement-periods";
import {
  sendFileRequestReminder,
  updateFileRequest,
  updateFileRequestStatus,
} from "@/data-access/fileRequests";
import { sendDirectEmail, renderTemplateWithFallback } from "@/lib/email/service";
import { AdminEscalationEmail } from "@/emails/admin-escalation";
import { BkmvOwnerEscalationEmail } from "@/emails/bkmv-owner-escalation";
import { formatDateAsLocal } from "@/lib/date-utils";
import { startCronLog } from "@/lib/cron-logger";

/**
 * Upload Reminders Cron Job
 *
 * Sends reminders for file requests that haven't received uploads.
 *
 * Supplier flow (entityType=supplier):
 *   - 7 days after sent: 1st reminder
 *   - 3 days after 1st: 2nd reminder
 *   - After 2 reminders: escalation email to Reut (reutl@latableg.com)
 *
 * BKMV flow (entityType=franchisee, requestType=bkmv in metadata):
 *   - 2 days after sent: 1st reminder (to accountant)
 *   - 2 days later: 2nd reminder (to accountant)
 *   - 2 days later: 3rd reminder (to accountant + owners) - escalation
 *   - Continues every 2 days to both until upload
 *
 * Query params:
 * - action: "all" | "initial" | "followup" (default: "all")
 * - dryRun: "true" to simulate without sending emails
 */

const ADMIN_EMAIL = "reutl@latableg.com";

interface ReminderResult {
  processed: number;
  escalated: number;
  failed: number;
  autoClosed: number;
  errors: string[];
  requests: string[];
}

/**
 * Defense-in-depth: detect file_requests whose file is actually already on
 * disk. Two upload paths exist:
 *  - Public link: uploaded_file.upload_link_id == fileRequest.upload_link_id
 *  - Admin BKMV upload: uploaded_file.franchisee_id == fileRequest.entity_id
 *    (no upload_link). BKMV is a year-to-date snapshot whose period_start_date
 *    is the FIRST transaction in the file (often a prior year), so we must
 *    check period_end_date — a file "covers" the cycle iff its period extends
 *    to or past cycleStart.
 *
 * If a match exists we self-heal by closing the file_request to "submitted"
 * and skipping the reminder. This guards against the historical bug where
 * markFileRequestAsSubmitted was never called on upload completion.
 */
async function findUploadedFileForRequest(
  req: FileRequest
): Promise<Date | null> {
  if (req.uploadLinkId) {
    const linkMatches = await database
      .select({ createdAt: uploadedFile.createdAt })
      .from(uploadedFile)
      .where(eq(uploadedFile.uploadLinkId, req.uploadLinkId))
      .orderBy(uploadedFile.createdAt)
      .limit(1);
    if (linkMatches.length > 0) return linkMatches[0].createdAt;
  }

  const meta = req.metadata as Record<string, unknown> | null;

  // Supplier admin-upload path. The /admin/supplier-files save endpoint writes
  // to supplier_file_upload, NOT uploaded_file, so the uploadLinkId branch
  // above never matches. Without this check, every supplier whose file Reut
  // uploaded out-of-band keeps receiving 7-day reminders + escalations on a
  // permanent loop. Match by supplier_id + the file_request's intended period
  // (derived from metadata.periodKey), and only accept approved uploads.
  if (
    req.entityType === "supplier" &&
    req.entityId &&
    req.documentType === "settlement_report" &&
    req.createdAt
  ) {
    const periodKey = meta?.periodKey as string | undefined;
    let periodStart: string | null = null;
    let periodEnd: string | null = null;
    if (periodKey) {
      const periodInfo = getPeriodByKey(periodKey);
      if (periodInfo) {
        periodStart = formatDateAsLocal(periodInfo.startDate);
        periodEnd = formatDateAsLocal(periodInfo.endDate);
      }
    }

    const conditions = [
      eq(supplierFileUpload.supplierId, req.entityId),
      inArray(supplierFileUpload.processingStatus, ["approved", "auto_approved"]),
    ];
    if (periodStart && periodEnd) {
      // Exact period match — (supplierId, periodStart, periodEnd) uniquely
      // identifies the right file. Don't filter by createdAt: pre-uploads can
      // land months before the settlement-requests cron creates the request
      // (e.g. semi-annual suppliers uploading right after H2 closes, while
      // catch-up creates the request 60+ days later).
      conditions.push(eq(supplierFileUpload.periodStartDate, periodStart));
      conditions.push(eq(supplierFileUpload.periodEndDate, periodEnd));
    } else {
      // No periodKey — can't uniquely identify the right file, so fall back to
      // a wide time window relative to the request.
      const earliestCreatedAt = new Date(req.createdAt);
      earliestCreatedAt.setDate(earliestCreatedAt.getDate() - 180);
      conditions.push(gte(supplierFileUpload.createdAt, earliestCreatedAt));
    }

    const supplierUploads = await database
      .select({ createdAt: supplierFileUpload.createdAt })
      .from(supplierFileUpload)
      .where(and(...conditions))
      .orderBy(supplierFileUpload.createdAt)
      .limit(1);
    if (supplierUploads.length > 0) return supplierUploads[0].createdAt;
  }

  const isBkmv = req.entityType === "franchisee" && meta?.requestType === "bkmv";
  if (isBkmv && req.entityId && req.createdAt) {
    // Parse the cycle start (stored as "DD/MM/YYYY" in metadata) so we don't
    // accept a snapshot that ends before this fiscal year began.
    const cycleStart = parseDdMmYyyy(meta?.startDate as string | undefined);

    // Allow uploads up to 60 days before the request was created, so admin
    // pre-uploads (e.g., file uploaded a few weeks before the quarterly cron)
    // still satisfy the request.
    const earliestCreatedAt = new Date(req.createdAt);
    earliestCreatedAt.setDate(earliestCreatedAt.getDate() - 60);

    const conditions = [
      eq(uploadedFile.franchiseeId, req.entityId),
      gte(uploadedFile.createdAt, earliestCreatedAt),
      eq(uploadedFile.processingStatus, "approved"),
    ];
    if (cycleStart) {
      conditions.push(gte(uploadedFile.periodEndDate, cycleStart));
    }

    const adminMatches = await database
      .select({ createdAt: uploadedFile.createdAt })
      .from(uploadedFile)
      .where(and(...conditions))
      .orderBy(uploadedFile.createdAt)
      .limit(1);
    if (adminMatches.length > 0) return adminMatches[0].createdAt;
  }

  return null;
}

function parseDdMmYyyy(value: string | undefined): string | null {
  if (!value) return null;
  const parts = value.split("/");
  if (parts.length !== 3) return null;
  const [dd, mm, yyyy] = parts;
  if (!dd || !mm || !yyyy) return null;
  return `${yyyy}-${mm.padStart(2, "0")}-${dd.padStart(2, "0")}`;
}

// Reminder config per entity type
interface EntityReminderConfig {
  daysAfterSent: number;
  reminderInterval: number;
  maxRemindersBeforeEscalation: number;
}

function getReminderConfig(req: FileRequest): EntityReminderConfig {
  const meta = req.metadata as Record<string, unknown> | null;
  const isBkmv = req.entityType === "franchisee" && meta?.requestType === "bkmv";

  if (isBkmv) {
    return { daysAfterSent: 2, reminderInterval: 2, maxRemindersBeforeEscalation: 2 };
  }
  // Supplier defaults
  return { daysAfterSent: 7, reminderInterval: 3, maxRemindersBeforeEscalation: 2 };
}

// Get all sent file requests that may need reminders
async function getSentFileRequests(): Promise<FileRequest[]> {
  return database
    .select()
    .from(fileRequest)
    .where(eq(fileRequest.status, "sent")) as unknown as Promise<FileRequest[]>;
}

// Get owner emails for a franchisee
async function getOwnerEmails(franchiseeId: string): Promise<string[]> {
  const owners = await database
    .select({ email: contact.email })
    .from(contact)
    .where(
      and(
        eq(contact.franchiseeId, franchiseeId),
        eq(contact.role, "owner"),
        eq(contact.isActive, true)
      )
    );
  return owners.map((o) => o.email).filter((e): e is string => !!e);
}

// Send escalation email to Reut about a supplier that hasn't uploaded
async function sendSupplierEscalation(
  req: FileRequest,
  dryRun: boolean
): Promise<{ success: boolean; error?: string }> {
  const meta = req.metadata as Record<string, unknown> | null;
  const periodDescription = (meta?.periodDescription as string) || "לא ידוע";
  const reminders = (req.remindersSent || []) as string[];

  if (dryRun) return { success: true };

  const vars = {
    supplier_name: req.recipientName || req.recipientEmail,
    period: periodDescription,
    original_sent_date: req.sentAt
      ? new Date(req.sentAt).toLocaleDateString("he-IL")
      : "לא ידוע",
    reminders_sent: String(reminders.length),
  };

  const { html, text } = await renderTemplateWithFallback(
    "admin_escalation",
    () => AdminEscalationEmail(vars),
    vars
  );

  return sendDirectEmail({
    to: ADMIN_EMAIL,
    subject: `התראה: הספק ${req.recipientName || req.recipientEmail} לא העלה דוח`,
    html,
    text,
    entityType: "admin_escalation",
    entityId: req.id,
    metadata: {
      fileRequestId: req.id,
      supplierName: req.recipientName,
      escalationType: "supplier_no_upload",
    },
  });
}

// Send BKMV escalation to owners (while still including the accountant)
async function sendBkmvOwnerEscalation(
  req: FileRequest,
  ownerEmails: string[],
  dryRun: boolean
): Promise<{ success: boolean; sentCount: number; errors: string[] }> {
  const meta = req.metadata as Record<string, unknown> | null;
  const startDate = (meta?.startDate as string) || "01/01/2026";
  const originalSentDate = req.sentAt
    ? new Date(req.sentAt).toLocaleDateString("he-IL")
    : "לא ידוע";

  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "http://localhost:3000";
  const uploadUrl = meta?.uploadToken ? `${baseUrl}/upload/${meta.uploadToken}` : "";

  const result = { success: false, sentCount: 0, errors: [] as string[] };

  for (const email of ownerEmails) {
    if (dryRun) {
      result.sentCount++;
      continue;
    }

    const ownerVars = {
      original_sent_date: originalSentDate,
      start_date: startDate,
      upload_link: uploadUrl,
      franchisee_name: req.recipientName || "",
    };

    const { html, text } = await renderTemplateWithFallback(
      "bkmv_owner_escalation",
      () => BkmvOwnerEscalationEmail(ownerVars),
      ownerVars
    );

    const sendResult = await sendDirectEmail({
      to: email,
      subject: `תזכורת: קובץ מבנה אחיד BKMV טרם הועלה - ${req.recipientName || ""}`,
      html,
      text,
      entityType: "bkmv_owner_escalation",
      entityId: req.id,
      metadata: {
        fileRequestId: req.id,
        franchiseeId: req.entityId,
        escalationType: "bkmv_owner",
      },
    });

    if (sendResult.success) {
      result.sentCount++;
    } else {
      result.errors.push(`${email}: ${sendResult.error}`);
    }
  }

  result.success = result.sentCount > 0;
  return result;
}

// Main processing logic
async function processReminders(dryRun: boolean): Promise<ReminderResult> {
  const results: ReminderResult = {
    processed: 0,
    escalated: 0,
    failed: 0,
    autoClosed: 0,
    errors: [],
    requests: [],
  };

  const allRequests = await getSentFileRequests();
  const now = new Date();

  for (const req of allRequests) {
    try {
      // Self-heal: if the file already arrived (public link or admin upload),
      // close the request and skip the reminder.
      const uploadedAt = await findUploadedFileForRequest(req);
      if (uploadedAt) {
        if (!dryRun) {
          await updateFileRequestStatus(req.id, "submitted", {
            submittedAt: uploadedAt,
          });
        }
        results.autoClosed++;
        results.requests.push(`${req.id} (auto-closed: file already uploaded)`);
        continue;
      }

      const config = getReminderConfig(req);
      const reminders = (req.remindersSent || []) as string[];
      const reminderCount = reminders.length;
      const meta = req.metadata as Record<string, unknown> | null;

      // Already escalated and past max? For suppliers, stop after escalation
      if (
        req.entityType === "supplier" &&
        reminderCount >= config.maxRemindersBeforeEscalation &&
        meta?.escalatedToAdmin
      ) {
        continue; // Already escalated, no more reminders for suppliers
      }

      // Determine the reference date for timing
      let referenceDate: Date;
      if (reminderCount === 0) {
        // No reminders sent yet - check against sentAt
        if (!req.sentAt) continue;
        referenceDate = new Date(req.sentAt);
        const daysSinceSent = Math.floor(
          (now.getTime() - referenceDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysSinceSent < config.daysAfterSent) continue;
      } else {
        // Check against last reminder date
        const lastReminderDate = new Date(reminders[reminders.length - 1]);
        const daysSinceLastReminder = Math.floor(
          (now.getTime() - lastReminderDate.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysSinceLastReminder < config.reminderInterval) continue;
      }

      // Check if this should be an escalation
      const shouldEscalate = reminderCount >= config.maxRemindersBeforeEscalation;
      const isBkmv = req.entityType === "franchisee" && meta?.requestType === "bkmv";

      if (shouldEscalate && req.entityType === "supplier") {
        // Supplier escalation: send alert to Reut
        const escResult = await sendSupplierEscalation(req, dryRun);
        if (escResult.success) {
          results.escalated++;
          results.requests.push(`${req.id} (escalated to admin)`);
          if (!dryRun) {
            await updateFileRequest(req.id, {
              metadata: { ...meta, escalatedToAdmin: true, escalatedAt: new Date().toISOString() },
            });
          }
        } else {
          results.failed++;
          results.errors.push(`${req.id}: escalation failed - ${escResult.error}`);
        }
      } else if (shouldEscalate && isBkmv) {
        // BKMV escalation: send to accountant (regular reminder) + owners
        const reminderResult = await sendFileRequestReminder(req.id);
        if (reminderResult.success) {
          results.processed++;
          results.requests.push(req.id);
        }

        // Also send to owners
        const ownerEmails = await getOwnerEmails(req.entityId);
        if (ownerEmails.length > 0) {
          const ownerResult = await sendBkmvOwnerEscalation(req, ownerEmails, dryRun);
          if (ownerResult.success) {
            results.escalated++;
          }
          if (ownerResult.errors.length > 0) {
            results.errors.push(...ownerResult.errors);
          }
        }

        // Update escalation level in metadata
        if (!dryRun) {
          const currentLevel = (meta?.escalationLevel as number) || 0;
          await updateFileRequest(req.id, {
            metadata: { ...meta, escalationLevel: currentLevel + 1 },
          });
        }
      } else {
        // Regular reminder (no escalation)
        const sendResult = await sendFileRequestReminder(req.id);
        if (sendResult.success) {
          results.processed++;
          results.requests.push(req.id);
        } else {
          results.failed++;
          results.errors.push(`${req.id}: ${sendResult.error}`);
        }
      }
    } catch (error) {
      results.failed++;
      results.errors.push(
        `${req.id}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  return results;
}

export async function POST(request: NextRequest) {
  try {
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get("authorization");

    if (!cronSecret) {
      return NextResponse.json({ error: "Server misconfigured" }, { status: 503 });
    }
    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const dryRun = searchParams.get("dryRun") === "true";

    const cronLog = dryRun ? null : await startCronLog("upload-reminders");
    const reminderResults = await processReminders(dryRun);

    await cronLog?.complete({
      emailsSent: reminderResults.processed + reminderResults.escalated,
      emailsFailed: reminderResults.failed,
      totalProcessed: reminderResults.processed,
      totalSkipped: reminderResults.autoClosed,
      totalFailed: reminderResults.failed,
      summary: reminderResults as unknown as Record<string, unknown>,
    }, reminderResults.errors.length > 0 ? reminderResults.errors.join("; ") : undefined);

    return NextResponse.json({
      success: true,
      timestamp: formatDateAsLocal(new Date()),
      dryRun,
      ...reminderResults,
    });
  } catch (error) {
    console.error("Error processing upload reminders cron job:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}

/**
 * GET /api/cron/upload-reminders - Called by Vercel Cron
 * Vercel Cron sends GET requests, so this must execute the same logic as POST.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}
