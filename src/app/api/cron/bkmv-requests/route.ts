import { NextRequest, NextResponse } from "next/server";
import { render } from "@react-email/components";
import { database } from "@/db";
import {
  franchisee,
  contact,
  fileRequest,
  type Franchisee,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createFileRequest } from "@/data-access/fileRequests";
import { sendDirectEmail } from "@/lib/email/service";
import { BkmvRequestEmail } from "@/emails/bkmv-request";
import { formatDateAsLocal } from "@/lib/date-utils";

/**
 * BKMV File Requests Cron Job
 *
 * Runs on the 15th of January, April, July, October.
 * Sends BKMV (מבנה אחיד) file requests to franchisee accountants.
 *
 * Flow:
 * 1. Get all active franchisees
 * 2. For each: find accountant contact (role=accountant)
 * 3. Create file request with upload link
 * 4. Send email to accountant
 *
 * Period: From start of fiscal year (01/01/YYYY) until today
 *
 * Query params:
 * - action: "all" (default)
 * - dryRun: "true" to simulate without sending emails
 */

// Check if today is a BKMV request date (15th of Jan/Apr/Jul/Oct)
function isBkmvRequestDate(date: Date): boolean {
  const day = date.getDate();
  const month = date.getMonth() + 1; // 1-indexed
  return day === 15 && [1, 4, 7, 10].includes(month);
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

// Check if a BKMV request already exists for this franchisee and period
async function hasExistingBkmvRequest(
  franchiseeId: string,
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
    if (meta?.requestType === "bkmv" && meta?.startDate === startDate) {
      return true;
    }
  }
  return false;
}

async function processBkmvRequests(dryRun: boolean): Promise<{
  processed: number;
  skipped: number;
  failed: number;
  noAccountant: number;
  errors: string[];
  franchisees: string[];
}> {
  const results = {
    processed: 0,
    skipped: 0,
    failed: 0,
    noAccountant: 0,
    errors: [] as string[],
    franchisees: [] as string[],
  };

  const allFranchisees = await getActiveFranchisees();
  const startDate = getBkmvStartDate();

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

      // Dedup check
      if (!dryRun) {
        const alreadySent = await hasExistingBkmvRequest(f.id, startDate);
        if (alreadySent) {
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
        maxFiles: 1,
        sendImmediately: true,
        metadata: {
          requestType: "bkmv",
          startDate,
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
    const forceRun = searchParams.get("force") === "true";

    // Check if today is a BKMV request date (unless force flag)
    if (!forceRun && !isBkmvRequestDate(new Date())) {
      return NextResponse.json({
        success: true,
        message: "Not a BKMV request date. Use force=true to override.",
        timestamp: formatDateAsLocal(new Date()),
        nextBkmvDate: getNextBkmvDate(),
      });
    }

    const bkmvResults = await processBkmvRequests(dryRun);

    return NextResponse.json({
      success: true,
      timestamp: formatDateAsLocal(new Date()),
      dryRun,
      startDate: getBkmvStartDate(),
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
