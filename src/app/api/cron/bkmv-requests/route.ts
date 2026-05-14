import { NextRequest, NextResponse } from "next/server";
import { render } from "@react-email/components";
import { database } from "@/db";
import {
  franchisee,
  contact,
  fileRequest,
  uploadedFile,
  type Franchisee,
} from "@/db/schema";
import { eq, and, gte } from "drizzle-orm";
import { createFileRequest } from "@/data-access/fileRequests";
import { sendDirectEmail } from "@/lib/email/service";
import { getEmailTemplateByCode } from "@/data-access/emailTemplates";
import { BkmvRequestEmail } from "@/emails/bkmv-request";
import { formatDateAsLocal } from "@/lib/date-utils";
import { startCronLog } from "@/lib/cron-logger";

// Resolve default email template for BKMV file requests.
// Without this the cron silently created file_requests with no template,
// sendFileRequestEmail returned { success: false, error: "No email template specified" },
// and the failure was swallowed so the cron reported success while no email went out.
let cachedBkmvTemplateId: string | undefined;
async function resolveBkmvTemplateId(): Promise<string | undefined> {
  if (cachedBkmvTemplateId) return cachedBkmvTemplateId;
  const template = await getEmailTemplateByCode("bkmv_request");
  cachedBkmvTemplateId = template?.id;
  return cachedBkmvTemplateId;
}

/**
 * BKMV File Requests Cron Job
 *
 * Schedule fires quarterly (15th of Jan/Apr/Jul/Oct), but the cron ALSO runs
 * daily catch-up: for the most recent past BKMV cycle, any franchisee who
 * hasn't received the email yet will get it on the next successful run.
 * Dedup is per-cycle (cycleKey = "YYYY-MM"), so each franchisee gets exactly
 * one email per quarterly cycle even if the cron runs many times.
 *
 * Flow:
 * 1. Resolve current BKMV cycle (most recent past Jan/Apr/Jul/Oct 15th)
 * 2. Get all active franchisees
 * 3. For each: find accountant contact (role=accountant)
 * 4. Skip if a request already exists for this cycle
 * 5. Otherwise: create file request + send email
 *
 * Period: From start of fiscal year (01/01/YYYY) until today
 *
 * Query params:
 * - action: "all" (default)
 * - dryRun: "true" to simulate without sending emails
 * - force: "true" to bypass the "must be on/after a BKMV date" check
 */

interface BkmvCycle {
  year: number;
  month: number; // 1, 4, 7, 10
  cycleKey: string; // e.g. "2026-04"
  startDate: string; // "01/01/YYYY" (display)
}

// Return the most recent BKMV cycle whose 15th is <= today, or null if none
// has occurred yet this calendar year (e.g., cron runs in early January
// before Jan 15).
function getCurrentBkmvCycle(date: Date): BkmvCycle | null {
  const year = date.getFullYear();
  const cycleMonths = [1, 4, 7, 10]; // 1-indexed
  let chosen: { year: number; month: number } | null = null;

  for (const m of cycleMonths) {
    const cycleDate = new Date(year, m - 1, 15);
    if (cycleDate.getTime() <= date.getTime()) {
      chosen = { year, month: m };
    }
  }

  // Wrap to previous year's Q4 if we're between Jan 1 and Jan 14.
  if (!chosen) {
    chosen = { year: year - 1, month: 10 };
  }

  return {
    year: chosen.year,
    month: chosen.month,
    cycleKey: `${chosen.year}-${String(chosen.month).padStart(2, "0")}`,
    startDate: `01/01/${chosen.year}`,
  };
}

// Get start date for BKMV period (01/01 of current year)
function getBkmvStartDate(): string {
  const year = new Date().getFullYear();
  return `01/01/${year}`;
}

// Get all active franchisees (excluding "other" category)
async function getActiveFranchisees(): Promise<Franchisee[]> {
  return database
    .select()
    .from(franchisee)
    .where(
      and(
        eq(franchisee.isActive, true),
        eq(franchisee.category, "regular")
      )
    ) as unknown as Promise<Franchisee[]>;
}

// Get accountant email for a franchisee from contacts table
async function getAccountantEmail(franchiseeId: string): Promise<string | null> {
  const results = await database
    .select({ email: contact.email })
    .from(contact)
    .where(
      and(
        eq(contact.franchiseeId, franchiseeId),
        eq(contact.role, "accountant"),
        eq(contact.isActive, true)
      )
    )
    .limit(1);

  return results[0]?.email || null;
}

// Has the franchisee already uploaded an approved BKMV file covering this
// cycle? A BKMV file is a year-to-date snapshot, so any approved upload from
// the current fiscal year whose periodEndDate >= the cycle's start counts.
// Without this, the cron sends "אנא העלה BKMV" emails to franchisees who
// uploaded in late January (production showed 20+ cases at the April 15 cron).
async function hasUploadedBkmvForCycle(
  franchiseeId: string,
  cycleStartIso: string
): Promise<boolean> {
  const matches = await database
    .select({ id: uploadedFile.id })
    .from(uploadedFile)
    .where(
      and(
        eq(uploadedFile.franchiseeId, franchiseeId),
        eq(uploadedFile.processingStatus, "approved"),
        gte(uploadedFile.periodEndDate, cycleStartIso)
      )
    )
    .limit(1);
  return matches.length > 0;
}

// Check if a BKMV request already exists for this franchisee and cycle.
// Falls back to startDate match for legacy requests created before cycleKey
// was tracked in metadata.
async function hasExistingBkmvRequest(
  franchiseeId: string,
  cycleKey: string,
  startDate: string
): Promise<boolean> {
  const existing = await database
    .select()
    .from(fileRequest)
    .where(
      and(
        eq(fileRequest.entityType, "franchisee"),
        eq(fileRequest.entityId, franchiseeId),
        eq(fileRequest.documentType, "bkmv")
      )
    );

  for (const req of existing) {
    const meta = req.metadata as Record<string, unknown> | null;
    if (meta?.requestType !== "bkmv") continue;
    if (meta?.cycleKey === cycleKey) return true;
    // Legacy: if no cycleKey was stored, treat any record from this cycle's
    // startDate as a match for that cycle.
    if (!meta?.cycleKey && meta?.startDate === startDate) {
      const created = req.createdAt ? new Date(req.createdAt) : null;
      if (created) {
        const [, monthStr] = cycleKey.split("-");
        const cycleMonth = parseInt(monthStr, 10) - 1;
        const cycleStart = new Date(parseInt(cycleKey.split("-")[0], 10), cycleMonth, 15);
        const nextCycleStart = new Date(cycleStart);
        nextCycleStart.setMonth(nextCycleStart.getMonth() + 3);
        if (created >= cycleStart && created < nextCycleStart) return true;
      }
    }
  }
  return false;
}

async function processBkmvRequests(
  dryRun: boolean,
  cycle: BkmvCycle
): Promise<{
  processed: number;
  skipped: number;
  failed: number;
  noAccountant: number;
  errors: string[];
  franchisees: string[];
  cycleKey: string;
}> {
  const results = {
    processed: 0,
    skipped: 0,
    failed: 0,
    noAccountant: 0,
    errors: [] as string[],
    franchisees: [] as string[],
    cycleKey: cycle.cycleKey,
  };

  const allFranchisees = await getActiveFranchisees();
  const startDate = cycle.startDate;

  const emailTemplateId = await resolveBkmvTemplateId();
  if (!emailTemplateId && !dryRun) {
    results.errors.push(
      'Email template "bkmv_request" not found in database. Aborting before any file requests are created.'
    );
    return results;
  }

  for (const f of allFranchisees) {
    try {
      // Get accountant email
      const accountantEmail = await getAccountantEmail(f.id);
      if (!accountantEmail) {
        // Fallback to franchisee's primary contact email
        const fallbackEmail = f.primaryContactEmail || f.contactEmail;
        if (!fallbackEmail) {
          results.noAccountant++;
          results.errors.push(
            `${f.name} (${f.code}): No accountant or primary contact email`
          );
          continue;
        }
        // Use fallback but note it
        results.errors.push(
          `${f.name} (${f.code}): No accountant contact, using primary contact`
        );
      }

      const recipientEmail = accountantEmail || f.primaryContactEmail || f.contactEmail!;

      // Dedup check (per BKMV cycle, with legacy startDate fallback)
      if (!dryRun) {
        const alreadySent = await hasExistingBkmvRequest(f.id, cycle.cycleKey, startDate);
        if (alreadySent) {
          results.skipped++;
          continue;
        }

        // Don't ask for a BKMV that's already on disk for this fiscal year.
        // cycle.startDate is "01/01/YYYY"; convert to ISO for the date column.
        const cycleStartIso = `${cycle.year}-01-01`;
        const alreadyUploaded = await hasUploadedBkmvForCycle(f.id, cycleStartIso);
        if (alreadyUploaded) {
          results.skipped++;
          continue;
        }
      }

      if (dryRun) {
        results.processed++;
        results.franchisees.push(`${f.name} → ${recipientEmail}`);
        continue;
      }

      // Create file request with upload link
      await createFileRequest({
        entityType: "franchisee",
        entityId: f.id,
        documentType: "bkmv",
        description: `קובץ מבנה אחיד BKMV מ-${startDate} ועד היום`,
        recipientEmail,
        recipientName: f.name,
        emailTemplateId,
        maxFiles: 1,
        sendImmediately: true,
        metadata: {
          requestType: "bkmv",
          startDate,
          cycleKey: cycle.cycleKey,
          cronTriggered: true,
          requestedAt: new Date().toISOString(),
        },
      });

      results.processed++;
      results.franchisees.push(f.name);
    } catch (error) {
      results.failed++;
      results.errors.push(
        `${f.name} (${f.id}): ${error instanceof Error ? error.message : "Unknown error"}`
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
    // `force` is kept for backwards compatibility but no longer required:
    // the cron now runs daily catch-up for the most recent past BKMV cycle.

    const now = new Date();
    const cycle = getCurrentBkmvCycle(now);

    if (!cycle) {
      return NextResponse.json({
        success: true,
        message: "No BKMV cycle has occurred yet.",
        timestamp: formatDateAsLocal(now),
        nextBkmvDate: getNextBkmvDate(),
      });
    }

    const cronLog = dryRun ? null : await startCronLog("bkmv-requests");
    const bkmvResults = await processBkmvRequests(dryRun, cycle);

    await cronLog?.complete({
      emailsSent: bkmvResults.processed,
      emailsFailed: bkmvResults.failed,
      totalProcessed: bkmvResults.processed,
      totalSkipped: bkmvResults.skipped,
      totalFailed: bkmvResults.failed + bkmvResults.noAccountant,
      summary: bkmvResults as unknown as Record<string, unknown>,
    }, bkmvResults.errors.length > 0 ? bkmvResults.errors.join("; ") : undefined);

    return NextResponse.json({
      success: true,
      timestamp: formatDateAsLocal(new Date()),
      dryRun,
      cycle: cycle.cycleKey,
      startDate: cycle.startDate,
      ...bkmvResults,
    });
  } catch (error) {
    console.error("Error processing BKMV requests cron job:", error);
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
 * GET /api/cron/bkmv-requests - Called by Vercel Cron
 * Vercel Cron sends GET requests, so this must execute the same logic as POST.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}

// Helper to get next BKMV date
function getNextBkmvDate(): string {
  const now = new Date();
  const year = now.getFullYear();
  const bkmvDates = [
    new Date(year, 0, 15), // Jan 15
    new Date(year, 3, 15), // Apr 15
    new Date(year, 6, 15), // Jul 15
    new Date(year, 9, 15), // Oct 15
  ];

  for (const d of bkmvDates) {
    if (d > now) return formatDateAsLocal(d);
  }
  // Next year
  return formatDateAsLocal(new Date(year + 1, 0, 15));
}
