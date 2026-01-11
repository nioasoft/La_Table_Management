import { NextRequest, NextResponse } from "next/server";
import { database } from "@/db";
import { fileRequest, type FileRequest } from "@/db/schema";
import { eq, and, lt, isNull, sql } from "drizzle-orm";
import {
  sendFileRequestReminder,
} from "@/data-access/fileRequests";

/**
 * Upload Reminders Cron Job
 *
 * This endpoint sends reminders for file requests that have been sent
 * but haven't received uploads after a specified number of days.
 *
 * Query params:
 * - action: "all" | "initial" | "followup" (default: "all")
 * - daysAfterSent: days after initial send to send first reminder (default: 5)
 * - maxReminders: maximum number of reminders to send per request (default: 3)
 * - reminderIntervalDays: days between reminder emails (default: 3)
 * - dryRun: "true" to simulate without sending emails
 * - reminderTemplateId: Optional template ID for reminder emails
 *
 * Authentication:
 * This endpoint uses a secret token for authentication.
 * Set CRON_SECRET environment variable and pass it as Authorization header.
 */

interface ReminderConfig {
  daysAfterSent: number;
  maxReminders: number;
  reminderIntervalDays: number;
  dryRun: boolean;
  reminderTemplateId?: string;
}

// Get file requests that need initial reminder (sent X days ago, no reminders yet)
async function getRequestsNeedingInitialReminder(
  daysAfterSent: number
): Promise<FileRequest[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - daysAfterSent);

  // Get all sent requests and filter for those without reminders in JS
  const requests = (await database
    .select()
    .from(fileRequest)
    .where(
      and(
        eq(fileRequest.status, "sent"),
        lt(fileRequest.sentAt, cutoffDate)
      )
    )) as unknown as FileRequest[];

  // Filter for requests with no reminders
  return requests.filter((req) => {
    const reminders = req.remindersSent as string[] | null;
    return !reminders || reminders.length === 0;
  });
}

// Get file requests that need follow-up reminder
async function getRequestsNeedingFollowupReminder(
  maxReminders: number,
  reminderIntervalDays: number
): Promise<FileRequest[]> {
  const cutoffDate = new Date();
  cutoffDate.setDate(cutoffDate.getDate() - reminderIntervalDays);

  // Get all sent requests that have reminders
  const requests = (await database
    .select()
    .from(fileRequest)
    .where(eq(fileRequest.status, "sent"))) as unknown as FileRequest[];

  // Filter in application code for complex JSON logic
  return requests.filter((req) => {
    const reminders = req.remindersSent as string[] | null;
    if (!reminders || reminders.length === 0) return false;
    if (reminders.length >= maxReminders) return false;

    // Check if last reminder was sent more than reminderIntervalDays ago
    const lastReminder = new Date(reminders[reminders.length - 1]);
    return lastReminder < cutoffDate;
  });
}

// Send reminder for a file request
async function sendReminder(
  request: FileRequest,
  templateId?: string,
  dryRun: boolean = false
): Promise<{ success: boolean; error?: string }> {
  if (dryRun) {
    return { success: true };
  }

  const result = await sendFileRequestReminder(request.id, templateId);
  return result;
}

// Process initial reminders (first reminder after X days)
async function processInitialReminders(
  config: ReminderConfig
): Promise<{
  processed: number;
  failed: number;
  errors: string[];
  requests: string[];
}> {
  const results = {
    processed: 0,
    failed: 0,
    errors: [] as string[],
    requests: [] as string[],
  };

  const requests = await getRequestsNeedingInitialReminder(config.daysAfterSent);

  for (const request of requests) {
    try {
      const sendResult = await sendReminder(
        request,
        config.reminderTemplateId,
        config.dryRun
      );

      if (sendResult.success) {
        results.processed++;
        results.requests.push(request.id);
      } else {
        results.failed++;
        results.errors.push(`Request ${request.id}: ${sendResult.error}`);
      }
    } catch (error) {
      results.failed++;
      results.errors.push(
        `Request ${request.id}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  return results;
}

// Process follow-up reminders
async function processFollowupReminders(
  config: ReminderConfig
): Promise<{
  processed: number;
  failed: number;
  errors: string[];
  requests: string[];
}> {
  const results = {
    processed: 0,
    failed: 0,
    errors: [] as string[],
    requests: [] as string[],
  };

  const requests = await getRequestsNeedingFollowupReminder(
    config.maxReminders,
    config.reminderIntervalDays
  );

  for (const request of requests) {
    try {
      const sendResult = await sendReminder(
        request,
        config.reminderTemplateId,
        config.dryRun
      );

      if (sendResult.success) {
        results.processed++;
        results.requests.push(request.id);
      } else {
        results.failed++;
        results.errors.push(`Request ${request.id}: ${sendResult.error}`);
      }
    } catch (error) {
      results.failed++;
      results.errors.push(
        `Request ${request.id}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  return results;
}

export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get("authorization");

    if (cronSecret) {
      if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
        return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
      }
    } else {
      console.warn(
        "CRON_SECRET not set - cron endpoint is accessible without authentication"
      );
    }

    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get("action") || "all";
    const dryRun = searchParams.get("dryRun") === "true";

    const config: ReminderConfig = {
      daysAfterSent: parseInt(searchParams.get("daysAfterSent") || "5", 10),
      maxReminders: parseInt(searchParams.get("maxReminders") || "3", 10),
      reminderIntervalDays: parseInt(
        searchParams.get("reminderIntervalDays") || "3",
        10
      ),
      dryRun,
      reminderTemplateId: searchParams.get("reminderTemplateId") || undefined,
    };

    const results: {
      timestamp: string;
      dryRun: boolean;
      config: ReminderConfig;
      initial?: {
        processed: number;
        failed: number;
        errors: string[];
        requests: string[];
      };
      followup?: {
        processed: number;
        failed: number;
        errors: string[];
        requests: string[];
      };
      totals: {
        processed: number;
        failed: number;
        errors: string[];
      };
    } = {
      timestamp: new Date().toISOString(),
      dryRun,
      config,
      totals: {
        processed: 0,
        failed: 0,
        errors: [],
      },
    };

    // Process based on action
    if (action === "all" || action === "initial") {
      results.initial = await processInitialReminders(config);
      results.totals.processed += results.initial.processed;
      results.totals.failed += results.initial.failed;
      results.totals.errors.push(...results.initial.errors);
    }

    if (action === "all" || action === "followup") {
      results.followup = await processFollowupReminders(config);
      results.totals.processed += results.followup.processed;
      results.totals.failed += results.followup.failed;
      results.totals.errors.push(...results.followup.errors);
    }

    if (action !== "all" && action !== "initial" && action !== "followup") {
      return NextResponse.json(
        { error: "Invalid action. Use: all, initial, followup" },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      ...results,
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
 * GET /api/cron/upload-reminders - Health check for cron endpoint
 */
export async function GET(request: NextRequest) {
  // Verify cron secret for health check too
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (cronSecret && (!authHeader || authHeader !== `Bearer ${cronSecret}`)) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  // Get statistics
  const pendingInitial = await getRequestsNeedingInitialReminder(5);
  const pendingFollowup = await getRequestsNeedingFollowupReminder(3, 3);

  return NextResponse.json({
    status: "ok",
    endpoint: "/api/cron/upload-reminders",
    description: "Upload reminder scheduler for file requests",
    statistics: {
      pendingInitialReminders: pendingInitial.length,
      pendingFollowupReminders: pendingFollowup.length,
    },
    actions: {
      all: "Process all reminders (initial + followup)",
      initial: "Process initial reminders only (first reminder after X days)",
      followup: "Process follow-up reminders only",
    },
    usage: {
      method: "POST",
      queryParams: {
        action: "all | initial | followup",
        daysAfterSent:
          "days after initial send to send first reminder (default: 5)",
        maxReminders:
          "maximum number of reminders to send per request (default: 3)",
        reminderIntervalDays: "days between reminder emails (default: 3)",
        dryRun: "true to simulate without sending emails",
        reminderTemplateId: "optional template ID for reminder emails",
      },
      authentication: "Bearer token in Authorization header (CRON_SECRET)",
    },
    defaultBehavior: {
      initialReminder: "Sent 5 days after original file request",
      followupReminders: "Sent every 3 days after first reminder",
      maxReminders: "3 reminders total per request",
    },
  });
}
