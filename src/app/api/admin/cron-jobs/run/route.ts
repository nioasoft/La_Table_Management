import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";

// Allowlist of valid cron endpoints to prevent SSRF
const ALLOWED_CRON_ENDPOINTS = [
  "/api/cron/file-requests",
  "/api/cron/settlement-requests",
  "/api/cron/upload-reminders",
  "/api/cron/franchisee-reminders",
  "/api/cron/bkmv-requests",
];

/**
 * POST /api/admin/cron-jobs/run - Server-side proxy for running cron jobs
 * Keeps CRON_SECRET on the server, never exposed to the client.
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const body = await request.json();
    const { endpoint, dryRun = false } = body;

    if (!endpoint || typeof endpoint !== "string") {
      return NextResponse.json(
        { error: "Missing or invalid endpoint" },
        { status: 400 }
      );
    }

    // Extract the base path (without query params) for allowlist check
    const basePath = endpoint.split("?")[0];
    if (!ALLOWED_CRON_ENDPOINTS.includes(basePath)) {
      return NextResponse.json(
        { error: "Invalid cron endpoint" },
        { status: 400 }
      );
    }

    const cronSecret = process.env.CRON_SECRET;
    if (!cronSecret) {
      return NextResponse.json(
        { error: "CRON_SECRET not configured on server" },
        { status: 500 }
      );
    }

    // Build the full URL, preserving existing query params and adding dryRun
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || `http://localhost:${process.env.PORT || 3000}`;
    const url = new URL(endpoint, baseUrl);
    if (dryRun) {
      url.searchParams.set("dryRun", "true");
    }

    const response = await fetch(url.toString(), {
      method: "POST",
      headers: {
        Authorization: `Bearer ${cronSecret}`,
        "Content-Type": "application/json",
      },
    });

    const data = await response.json().catch(() => ({}));

    if (!response.ok) {
      return NextResponse.json(
        { error: data.error || "Cron job failed", details: data },
        { status: response.status }
      );
    }

    return NextResponse.json({
      success: true,
      dryRun,
      results: data,
    });
  } catch (error) {
    console.error("Error running cron job:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
