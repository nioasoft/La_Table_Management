import { NextRequest, NextResponse } from "next/server";
import {
  processScheduledFileRequests,
  expireOutdatedFileRequests,
  sendDueDateReminders,
} from "@/data-access/fileRequests";

// This endpoint is intended to be called by a cron job (e.g., Vercel Cron)
// It processes scheduled file requests, expires outdated ones, and sends reminders

/**
 * POST /api/cron/file-requests - Process file request jobs
 *
 * This endpoint handles three main tasks:
 * 1. Send scheduled file requests that are due
 * 2. Expire outdated file requests
 * 3. Send reminders for requests approaching due date
 *
 * Query params:
 * - action: "all" | "scheduled" | "expire" | "reminders" (default: "all")
 * - reminderDays: number of days before due date to send reminders (default: 3)
 *
 * Authentication:
 * This endpoint uses a secret token for authentication.
 * Set CRON_SECRET environment variable and pass it as Authorization header.
 */
export async function POST(request: NextRequest) {
  try {
    // Verify cron secret
    const cronSecret = process.env.CRON_SECRET;
    const authHeader = request.headers.get("authorization");

    if (!cronSecret) {
      console.error("CRON_SECRET must be configured");
      return NextResponse.json(
        { error: "Server misconfigured" },
        { status: 503 }
      );
    }
    if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const searchParams = request.nextUrl.searchParams;
    const action = searchParams.get("action") || "all";
    const reminderDays = parseInt(searchParams.get("reminderDays") || "3", 10);

    const results: {
      scheduled?: {
        processed: number;
        failed: number;
        errors: string[];
      };
      expired?: number;
      reminders?: {
        sent: number;
        failed: number;
        errors: string[];
      };
    } = {};

    // Process scheduled file requests
    if (action === "all" || action === "scheduled") {
      results.scheduled = await processScheduledFileRequests();
    }

    // Expire outdated file requests
    if (action === "all" || action === "expire") {
      results.expired = await expireOutdatedFileRequests();
    }

    // Send due date reminders
    if (action === "all" || action === "reminders") {
      results.reminders = await sendDueDateReminders(reminderDays);
    }

    return NextResponse.json({
      success: true,
      timestamp: new Date().toISOString(),
      results,
    });
  } catch (error) {
    console.error("Error processing file request cron job:", error);
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
 * GET /api/cron/file-requests - Health check for cron endpoint
 */
export async function GET(request: NextRequest) {
  // Verify cron secret for health check too
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret) {
    console.error("CRON_SECRET must be configured");
    return NextResponse.json(
      { error: "Server misconfigured" },
      { status: 503 }
    );
  }
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  return NextResponse.json({
    status: "ok",
    endpoint: "/api/cron/file-requests",
    description: "File request scheduled jobs processor",
    actions: {
      all: "Process all tasks (scheduled, expire, reminders)",
      scheduled: "Process scheduled file requests only",
      expire: "Expire outdated file requests only",
      reminders: "Send due date reminders only",
    },
    usage: {
      method: "POST",
      queryParams: {
        action: "all | scheduled | expire | reminders",
        reminderDays: "number of days before due date (default: 3)",
      },
      authentication: "Bearer token in Authorization header (CRON_SECRET)",
    },
  });
}
