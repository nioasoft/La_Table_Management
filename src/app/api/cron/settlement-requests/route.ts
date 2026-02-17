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

/**
 * Settlement File Requests Cron Job
 *
 * Runs daily. On the LAST DAY of each settlement period, sends file requests
 * to suppliers for that period's commission report.
 *
 * Settlement Frequencies:
 * - monthly: last day of each month
 * - quarterly: 31/3, 30/6, 30/9, 31/12
 * - semi_annual: 30/6, 31/12
 * - annual: 31/12
 *
 * Query params:
 * - action: "all" | specific frequency (default: "all")
 * - dryRun: "true" to simulate without sending emails
 * - emailTemplateId: Optional template ID for file request emails
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

/**
 * Get the last day of the current period for a given frequency.
 * Returns true if today is the last day of a period for that frequency.
 */
function isLastDayOfPeriod(frequency: SettlementFrequency, date: Date): boolean {
  const day = date.getDate();
  const month = date.getMonth(); // 0-indexed
  const lastDayOfMonth = new Date(date.getFullYear(), month + 1, 0).getDate();

  switch (frequency) {
    case "monthly":
      // Last day of every month
      return day === lastDayOfMonth;

    case "quarterly":
      // Last day of March (31), June (30), September (30), December (31)
      return day === lastDayOfMonth && [2, 5, 8, 11].includes(month);

    case "semi_annual":
      // Last day of June (30), December (31)
      return day === lastDayOfMonth && [5, 11].includes(month);

    case "annual":
      // Last day of December (31)
      return day === lastDayOfMonth && month === 11;

    case "bi_weekly":
      // 1st and 15th of each month
      return day === 1 || day === 15;

    case "weekly":
      // Every Sunday
      return date.getDay() === 0;

    default:
      return false;
  }
}

// Determine which settlement frequencies should be processed on this date
function getActiveFrequencies(date: Date): SettlementFrequency[] {
  const frequencies: SettlementFrequency[] = [];
  const all: SettlementFrequency[] = ["monthly", "quarterly", "semi_annual", "annual", "bi_weekly"];

  for (const freq of all) {
    if (isLastDayOfPeriod(freq, date)) {
      frequencies.push(freq);
    }
  }

  return frequencies;
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

// Get period description in Hebrew based on frequency
function getPeriodDescription(frequency: SettlementFrequency, date: Date): string {
  const hebrewMonths = [
    "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
    "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
  ];

  const year = date.getFullYear();
  const month = date.getMonth(); // 0-indexed

  switch (frequency) {
    case "monthly":
      return `חודש ${hebrewMonths[month]} ${year}`;
    case "quarterly": {
      const quarter = Math.floor(month / 3) + 1;
      return `רבעון ${quarter}/${year}`;
    }
    case "semi_annual": {
      const half = month < 6 ? 1 : 2;
      return `מחצית ${half}/${year}`;
    }
    case "annual":
      return `שנת ${year}`;
    case "bi_weekly":
      return `תקופה דו-שבועית - ${hebrewMonths[month]} ${year}`;
    case "weekly":
      return `שבוע ${date.toLocaleDateString("he-IL")}`;
    default:
      return `${hebrewMonths[month]} ${year}`;
  }
}

// Process file requests for a specific frequency
async function processFrequency(
  frequency: SettlementFrequency,
  emailTemplateId?: string,
  dryRun: boolean = false
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

  const now = new Date();
  const periodDescription = getPeriodDescription(frequency, now);

  // Create settlement period for this frequency if applicable
  const periodType = frequencyToPeriodType(frequency);
  if (periodType && !dryRun) {
    try {
      const periods = getPeriodsForFrequency(periodType, now, 1);
      if (periods.length > 0) {
        const currentPeriod = periods[0];
        const result = await getOrCreateSettlementPeriodByPeriodKey(currentPeriod.key);
        if (result) {
          results.settlementPeriodCreated = {
            periodKey: currentPeriod.key,
            created: result.created,
          };
        }
      }
    } catch (error) {
      results.errors.push(
        `Failed to create settlement period: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
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

      const dueDate = calculateDueDate(frequency);

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
        emailTemplateId: emailTemplateId || undefined,
        dueDate,
        maxFiles,
        sendImmediately: true,
        metadata: {
          settlementFrequency: frequency,
          periodDescription,
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
      frequenciesToProcess = getActiveFrequencies(new Date());
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

    for (const frequency of frequenciesToProcess) {
      const frequencyResults = await processFrequency(frequency, emailTemplateId, dryRun);
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

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  const authHeader = request.headers.get("authorization");

  if (!cronSecret) {
    return NextResponse.json({ error: "Server misconfigured" }, { status: 503 });
  }
  if (!authHeader || authHeader !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const now = new Date();
  const activeFrequencies = getActiveFrequencies(now);

  return NextResponse.json({
    status: "ok",
    endpoint: "/api/cron/settlement-requests",
    description: "Settlement file request scheduler - sends on last day of each period",
    currentDate: formatDateAsLocal(now),
    isLastDayOfMonth: now.getDate() === new Date(now.getFullYear(), now.getMonth() + 1, 0).getDate(),
    activeFrequencies,
    schedulingNotes: {
      monthly: "Last day of every month",
      quarterly: "Last day of March, June, September, December",
      semi_annual: "Last day of June, December",
      annual: "Last day of December",
    },
  });
}
