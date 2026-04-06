import { NextRequest, NextResponse } from "next/server";
import { database } from "@/db";
import { fileRequest, contact, type FileRequest } from "@/db/schema";
import { eq, and, lt } from "drizzle-orm";
import { sendFileRequestReminder, updateFileRequest } from "@/data-access/fileRequests";
import { sendDirectEmail, renderTemplateWithFallback } from "@/lib/email/service";
import { AdminEscalationEmail } from "@/emails/admin-escalation";
import { BkmvOwnerEscalationEmail } from "@/emails/bkmv-owner-escalation";
import { formatDateAsLocal } from "@/lib/date-utils";

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
  errors: string[];
  requests: string[];
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
    errors: [],
    requests: [],
  };

  const allRequests = await getSentFileRequests();
  const now = new Date();

  for (const req of allRequests) {
    try {
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

    const reminderResults = await processReminders(dryRun);

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
