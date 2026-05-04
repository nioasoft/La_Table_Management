import { NextRequest, NextResponse } from "next/server";
import { database } from "@/db";
import {
  supplier,
  supplierBrand,
  brand,
  fileRequest,
  type Supplier,
  type SettlementFrequency,
  type SettlementPeriodType,
} from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createFileRequest } from "@/data-access/fileRequests";
import { getOrCreateSettlementPeriodByPeriodKey } from "@/data-access/settlements";
import { formatDateAsLocal } from "@/lib/date-utils";
import { getPeriodsForFrequency } from "@/lib/settlement-periods";
import { getEmailTemplateByCode } from "@/data-access/emailTemplates";
import { startCronLog } from "@/lib/cron-logger";

/**
 * Settlement File Requests Cron Job
 *
 * Runs daily. For each settlement frequency, sends file requests to suppliers
 * for the most recently CLOSED period (period.endDate <= today).
 *
 * Catch-up behaviour: if the cron failed to run on the last day of a period,
 * subsequent days will still send the email (dedup via hasExistingFileRequest
 * keeps suppliers from receiving duplicates).
 *
 * Settlement Frequencies (period closes on):
 * - monthly: last day of each month
 * - quarterly: 31/3, 30/6, 30/9, 31/12
 * - semi_annual: 30/6, 31/12
 * - annual: last day of fiscal year
 *
 * Query params:
 * - action: "all" | specific frequency (default: "all")
 * - dryRun: "true" to simulate without sending emails
 * - emailTemplateId: Optional template ID for file request emails
 * - date: YYYY-MM-DD reference date for retroactive sends
 */

// Map settlement frequency to settlement period type
function frequencyToPeriodType(frequency: SettlementFrequency): SettlementPeriodType | null {
  switch (frequency) {
    case "monthly":
      return "monthly";
    case "quarterly":
      return "quarterly";
    case "semi_annual":
      return "semi_annual";
    case "annual":
      return "annual";
    default:
      return null;
  }
}

// All settlement frequencies are evaluated every day. The dedup check inside
// processFrequency (hasExistingFileRequest) ensures each supplier only gets
// one email per period, so running daily makes the cron resilient to missed
// days without producing duplicate sends.
function getActiveFrequencies(): SettlementFrequency[] {
  return ["monthly", "quarterly", "semi_annual", "annual"];
}

// Get suppliers by settlement frequency
async function getSuppliersByFrequency(
  frequency: SettlementFrequency
): Promise<Supplier[]> {
  return database
    .select()
    .from(supplier)
    .where(
      and(
        eq(supplier.isActive, true),
        eq(supplier.settlementFrequency, frequency)
      )
    ) as unknown as Promise<Supplier[]>;
}

// Get brand names for a supplier (Hebrew names joined with " / ")
async function getSupplierBrandNames(supplierId: string): Promise<string> {
  const results = await database
    .select({ nameHe: brand.nameHe })
    .from(supplierBrand)
    .innerJoin(brand, eq(supplierBrand.brandId, brand.id))
    .where(eq(supplierBrand.supplierId, supplierId));

  if (results.length === 0) return "לה טייבל";
  return results.map((r) => r.nameHe).join(" / ");
}

// Check if a file request already exists for this supplier and period
async function hasExistingFileRequest(
  supplierId: string,
  periodDescription: string
): Promise<boolean> {
  const existing = await database
    .select({ id: fileRequest.id })
    .from(fileRequest)
    .where(
      and(
        eq(fileRequest.entityType, "supplier"),
        eq(fileRequest.entityId, supplierId),
        eq(fileRequest.documentType, "settlement_report")
      )
    );

  // Check metadata for matching period
  for (const req of existing) {
    const full = await database
      .select()
      .from(fileRequest)
      .where(eq(fileRequest.id, req.id))
      .limit(1);
    if (full.length > 0) {
      const meta = full[0].metadata as Record<string, unknown> | null;
      if (meta?.periodDescription === periodDescription) {
        return true;
      }
    }
  }
  return false;
}

// Calculate due date based on settlement frequency
function calculateDueDate(frequency: SettlementFrequency): string {
  const now = new Date();
  const dueDate = new Date(now);

  switch (frequency) {
    case "weekly":
      dueDate.setDate(dueDate.getDate() + 7);
      break;
    case "bi_weekly":
      dueDate.setDate(dueDate.getDate() + 14);
      break;
    case "monthly":
      dueDate.setMonth(dueDate.getMonth() + 1);
      break;
    case "quarterly":
      dueDate.setMonth(dueDate.getMonth() + 3);
      break;
    case "semi_annual":
      dueDate.setMonth(dueDate.getMonth() + 6);
      break;
    case "annual":
      dueDate.setFullYear(dueDate.getFullYear() + 1);
      break;
    default:
      dueDate.setDate(dueDate.getDate() + 14);
  }

  return formatDateAsLocal(dueDate);
}

// Get period description in Hebrew based on frequency (fallback for
// bi_weekly/weekly which don't map to SettlementPeriodType).
function getPeriodDescription(frequency: SettlementFrequency, date: Date): string {
  const hebrewMonths = [
    "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
    "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
  ];

  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed

  switch (frequency) {
    case "bi_weekly":
      return `תקופה דו-שבועית - ${hebrewMonths[month]} ${year}`;
    case "weekly":
      return `שבוע ${date.toLocaleDateString("he-IL")}`;
    default:
      // For monthly/quarterly/semi_annual/annual we resolve the period via
      // getPeriodsForFrequency in processFrequency — this branch is unused.
      return `${hebrewMonths[month]} ${year}`;
  }
}

// Format a Date as DD/MM/YYYY for human-readable email display.
function formatDateForDisplay(date: Date): string {
  const day = String(date.getDate()).padStart(2, "0");
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const year = date.getFullYear();
  return `${day}/${month}/${year}`;
}

// Resolve default email template for supplier settlement requests
let cachedTemplateId: string | undefined;
async function resolveDefaultTemplateId(): Promise<string | undefined> {
  if (cachedTemplateId) return cachedTemplateId;
  const template = await getEmailTemplateByCode("supplier_request");
  cachedTemplateId = template?.id;
  return cachedTemplateId;
}

// Process file requests for a specific frequency
async function processFrequency(
  frequency: SettlementFrequency,
  emailTemplateId?: string,
  dryRun: boolean = false,
  referenceDate?: Date
): Promise<{
  processed: number;
  skipped: number;
  failed: number;
  errors: string[];
  suppliers: string[];
  settlementPeriodCreated?: { periodKey: string; created: boolean };
}> {
  const results = {
    processed: 0,
    skipped: 0,
    failed: 0,
    errors: [] as string[],
    suppliers: [] as string[],
    settlementPeriodCreated: undefined as { periodKey: string; created: boolean } | undefined,
  };

  const now = referenceDate || new Date();

  // Resolve the period that is CLOSING today (includeCurrent=true, count=1).
  // The cron fires on the last day of each settlement period, so "today's
  // closing period" is the one we want to reference in the email and create
  // a settlement period for.
  const periodType = frequencyToPeriodType(frequency);
  let periodDescription: string;
  let periodEndDateStr: string | null = null;
  let periodDueDateStr: string | null = null;

  if (periodType) {
    // Pick the most recently CLOSED period: prefer "current" if its endDate
    // has passed (or is today), otherwise fall back to the previous period.
    // This is the catch-up mechanism — running on May 4 still picks April
    // for monthly suppliers if April's email never went out.
    const candidates = getPeriodsForFrequency(periodType, now, 1, 1, true);
    const closedPeriod = candidates.find((p) => p.endDate.getTime() <= now.getTime());

    if (!closedPeriod) {
      // No closed period yet for this frequency — nothing to send.
      return results;
    }

    periodDescription = closedPeriod.nameHe;
    periodEndDateStr = formatDateForDisplay(closedPeriod.endDate);
    periodDueDateStr = formatDateAsLocal(closedPeriod.dueDate);

    if (!dryRun) {
      try {
        const result = await getOrCreateSettlementPeriodByPeriodKey(
          closedPeriod.key
        );
        if (result) {
          results.settlementPeriodCreated = {
            periodKey: closedPeriod.key,
            created: result.created,
          };
        }
      } catch (error) {
        results.errors.push(
          `Failed to create settlement period: ${error instanceof Error ? error.message : "Unknown error"}`
        );
      }
    }
  } else {
    // bi_weekly / weekly — keep the old ad-hoc description.
    periodDescription = getPeriodDescription(frequency, now);
  }

  const suppliers = await getSuppliersByFrequency(frequency);

  for (const supplierData of suppliers) {
    try {
      const recipientEmail = supplierData.contactEmail || supplierData.secondaryContactEmail;

      if (!recipientEmail) {
        results.failed++;
        results.errors.push(
          `Supplier ${supplierData.name} (${supplierData.id}): No email configured`
        );
        continue;
      }

      // Dedup check: skip if already sent for this period
      if (!dryRun) {
        const alreadySent = await hasExistingFileRequest(supplierData.id, periodDescription);
        if (alreadySent) {
          results.skipped++;
          continue;
        }
      }

      // Get brand names for this supplier
      const brandNames = await getSupplierBrandNames(supplierData.id);

      // Prefer the computed due date from the resolved period (period end
      // + 15 days). Fall back to the ad-hoc calculator for bi_weekly/weekly.
      const dueDate = periodDueDateStr ?? calculateDueDate(frequency);

      if (dryRun) {
        results.processed++;
        results.suppliers.push(`${supplierData.name} (${brandNames})`);
        continue;
      }

      const maxFiles = supplierData.fileMapping?.maxUploadFiles ?? 1;

      await createFileRequest({
        entityType: "supplier",
        entityId: supplierData.id,
        documentType: "settlement_report",
        description: `דוח עמלות רשת עבור ${periodDescription}`,
        recipientEmail,
        recipientName: supplierData.contactName || supplierData.name,
        emailTemplateId: emailTemplateId || await resolveDefaultTemplateId(),
        dueDate,
        maxFiles,
        sendImmediately: true,
        metadata: {
          settlementFrequency: frequency,
          periodDescription,
          periodEndDate: periodEndDateStr,
          brandNames,
          requestedAt: new Date().toISOString(),
          cronTriggered: true,
        },
      });

      results.processed++;
      results.suppliers.push(supplierData.name);
    } catch (error) {
      results.failed++;
      results.errors.push(
        `Supplier ${supplierData.name} (${supplierData.id}): ${
          error instanceof Error ? error.message : "Unknown error"
        }`
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
    const action = searchParams.get("action") || "all";
    const dryRun = searchParams.get("dryRun") === "true";
    const emailTemplateId = searchParams.get("emailTemplateId") || undefined;
    // Optional date override for retroactive sends (format: YYYY-MM-DD)
    const dateParam = searchParams.get("date");
    const referenceDate = dateParam ? new Date(dateParam) : undefined;

    const results: {
      timestamp: string;
      dryRun: boolean;
      activeFrequencies: SettlementFrequency[];
      byFrequency: Record<string, {
        processed: number;
        skipped: number;
        failed: number;
        errors: string[];
        suppliers: string[];
        settlementPeriodCreated?: { periodKey: string; created: boolean };
      }>;
      totals: { processed: number; skipped: number; failed: number; errors: string[] };
      settlementPeriodsCreated: { frequency: string; periodKey: string; created: boolean }[];
    } = {
      timestamp: formatDateAsLocal(new Date()),
      dryRun,
      activeFrequencies: [],
      byFrequency: {},
      totals: { processed: 0, skipped: 0, failed: 0, errors: [] },
      settlementPeriodsCreated: [],
    };

    let frequenciesToProcess: SettlementFrequency[];

    if (action === "all") {
      frequenciesToProcess = getActiveFrequencies();
    } else if (
      ["monthly", "quarterly", "semi_annual", "annual", "bi_weekly", "weekly"].includes(action)
    ) {
      frequenciesToProcess = [action as SettlementFrequency];
    } else {
      return NextResponse.json(
        { error: "Invalid action. Use: all, monthly, quarterly, semi_annual, annual, bi_weekly, weekly" },
        { status: 400 }
      );
    }

    results.activeFrequencies = frequenciesToProcess;

    const cronLog = dryRun ? null : await startCronLog("settlement-requests", "manual");

    for (const frequency of frequenciesToProcess) {
      const frequencyResults = await processFrequency(frequency, emailTemplateId, dryRun, referenceDate);
      results.byFrequency[frequency] = frequencyResults;
      results.totals.processed += frequencyResults.processed;
      results.totals.skipped += frequencyResults.skipped;
      results.totals.failed += frequencyResults.failed;
      results.totals.errors.push(...frequencyResults.errors);

      if (frequencyResults.settlementPeriodCreated) {
        results.settlementPeriodsCreated.push({
          frequency,
          ...frequencyResults.settlementPeriodCreated,
        });
      }
    }

    await cronLog?.complete({
      emailsSent: results.totals.processed,
      emailsFailed: results.totals.failed,
      totalProcessed: results.totals.processed,
      totalSkipped: results.totals.skipped,
      totalFailed: results.totals.failed,
      summary: { activeFrequencies: results.activeFrequencies, byFrequency: results.byFrequency },
    }, results.totals.errors.length > 0 ? results.totals.errors.join("; ") : undefined);

    return NextResponse.json({ success: true, ...results });
  } catch (error) {
    console.error("Error processing settlement requests cron job:", error);
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
 * GET /api/cron/settlement-requests - Called by Vercel Cron
 * Vercel Cron sends GET requests, so this must execute the same logic as POST.
 */
export async function GET(request: NextRequest) {
  return POST(request);
}
