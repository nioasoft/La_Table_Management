import { NextRequest, NextResponse } from "next/server";
import { database } from "@/db";
import { supplier, type Supplier, type SettlementFrequency } from "@/db/schema";
import { eq, and } from "drizzle-orm";
import { createFileRequest } from "@/data-access/fileRequests";
import { formatDateAsLocal } from "@/lib/date-utils";

/**
 * Settlement File Requests Cron Job
 *
 * This endpoint is called on the 1st of each month to send file requests
 * to suppliers based on their settlement frequency.
 *
 * Settlement Frequencies:
 * - monthly: Send every 1st of the month
 * - quarterly: Send on Jan 1, Apr 1, Jul 1, Oct 1
 * - semi_annual: Send on Jan 1, Jul 1
 * - annual: Send on Jan 1
 * - bi_weekly: Send every 1st and 15th
 * - weekly: Should be handled by a separate weekly job
 *
 * Query params:
 * - action: "all" | "monthly" | "quarterly" | "semi_annual" | "annual" | "bi_weekly" (default: "all")
 * - dryRun: "true" to simulate without sending emails
 * - emailTemplateId: Optional template ID for file request emails
 *
 * Authentication:
 * This endpoint uses a secret token for authentication.
 * Set CRON_SECRET environment variable and pass it as Authorization header.
 */

// Determine which settlement frequencies should be processed on this date
function getActiveFrequencies(date: Date): SettlementFrequency[] {
  const day = date.getDate();
  const month = date.getMonth() + 1; // 1-indexed

  const frequencies: SettlementFrequency[] = [];

  // Monthly: Every 1st of the month
  if (day === 1) {
    frequencies.push("monthly");
  }

  // Quarterly: Jan 1, Apr 1, Jul 1, Oct 1
  if (day === 1 && [1, 4, 7, 10].includes(month)) {
    frequencies.push("quarterly");
  }

  // Semi-annual: Jan 1, Jul 1
  if (day === 1 && [1, 7].includes(month)) {
    frequencies.push("semi_annual");
  }

  // Annual: Jan 1
  if (day === 1 && month === 1) {
    frequencies.push("annual");
  }

  // Bi-weekly: 1st and 15th of each month
  if (day === 1 || day === 15) {
    frequencies.push("bi_weekly");
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
      dueDate.setDate(dueDate.getDate() + 14); // Default 2 weeks
  }

  return formatDateAsLocal(dueDate);
}

// Get period description based on frequency
function getPeriodDescription(frequency: SettlementFrequency): string {
  const now = new Date();
  const month = now.toLocaleString("he-IL", { month: "long" });
  const year = now.getFullYear();

  switch (frequency) {
    case "monthly":
      // Previous month
      const prevMonth = new Date(now);
      prevMonth.setMonth(prevMonth.getMonth() - 1);
      return `${prevMonth.toLocaleString("he-IL", { month: "long" })} ${prevMonth.getFullYear()}`;
    case "quarterly":
      // Previous quarter
      const quarter = Math.floor((now.getMonth() - 1) / 3) + 1;
      return `רבעון ${quarter} ${year}`;
    case "semi_annual":
      // Previous half-year
      const halfYear = now.getMonth() < 6 ? 2 : 1;
      const halfYearYear = now.getMonth() < 6 ? year - 1 : year;
      return `חצי שנה ${halfYear} ${halfYearYear}`;
    case "annual":
      // Previous year
      return `שנת ${year - 1}`;
    case "bi_weekly":
      return `תקופה דו-שבועית - ${month} ${year}`;
    case "weekly":
      return `שבוע ${now.toLocaleDateString("he-IL")}`;
    default:
      return `${month} ${year}`;
  }
}

// Process file requests for a specific frequency
async function processFrequency(
  frequency: SettlementFrequency,
  emailTemplateId?: string,
  dryRun: boolean = false
): Promise<{
  processed: number;
  failed: number;
  errors: string[];
  suppliers: string[];
}> {
  const results = {
    processed: 0,
    failed: 0,
    errors: [] as string[],
    suppliers: [] as string[],
  };

  const suppliers = await getSuppliersByFrequency(frequency);

  for (const supplierData of suppliers) {
    try {
      // Get supplier email (prefer primary, fallback to secondary)
      const recipientEmail =
        supplierData.contactEmail || supplierData.secondaryContactEmail;

      if (!recipientEmail) {
        results.failed++;
        results.errors.push(
          `Supplier ${supplierData.name} (${supplierData.id}): No email configured`
        );
        continue;
      }

      const dueDate = calculateDueDate(frequency);
      const periodDescription = getPeriodDescription(frequency);

      if (dryRun) {
        // Dry run: just log what would be sent
        results.processed++;
        results.suppliers.push(supplierData.name);
        continue;
      }

      // Create and send file request
      await createFileRequest({
        entityType: "supplier",
        entityId: supplierData.id,
        documentType: "settlement_report",
        description: `דוח התחשבנות עבור ${periodDescription}`,
        recipientEmail,
        recipientName: supplierData.contactName || supplierData.name,
        emailTemplateId: emailTemplateId || undefined,
        dueDate,
        sendImmediately: true,
        metadata: {
          settlementFrequency: frequency,
          periodDescription,
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
    const dryRun = searchParams.get("dryRun") === "true";
    const emailTemplateId = searchParams.get("emailTemplateId") || undefined;

    const results: {
      timestamp: string;
      dryRun: boolean;
      activeFrequencies: SettlementFrequency[];
      byFrequency: Record<
        string,
        {
          processed: number;
          failed: number;
          errors: string[];
          suppliers: string[];
        }
      >;
      totals: {
        processed: number;
        failed: number;
        errors: string[];
      };
    } = {
      timestamp: new Date().toISOString(),
      dryRun,
      activeFrequencies: [],
      byFrequency: {},
      totals: {
        processed: 0,
        failed: 0,
        errors: [],
      },
    };

    // Determine which frequencies to process
    let frequenciesToProcess: SettlementFrequency[];

    if (action === "all") {
      // Auto-detect based on current date
      frequenciesToProcess = getActiveFrequencies(new Date());
    } else if (
      action === "monthly" ||
      action === "quarterly" ||
      action === "semi_annual" ||
      action === "annual" ||
      action === "bi_weekly" ||
      action === "weekly"
    ) {
      frequenciesToProcess = [action as SettlementFrequency];
    } else {
      return NextResponse.json(
        { error: "Invalid action. Use: all, monthly, quarterly, semi_annual, annual, bi_weekly, weekly" },
        { status: 400 }
      );
    }

    results.activeFrequencies = frequenciesToProcess;

    // Process each frequency
    for (const frequency of frequenciesToProcess) {
      const frequencyResults = await processFrequency(
        frequency,
        emailTemplateId,
        dryRun
      );

      results.byFrequency[frequency] = frequencyResults;
      results.totals.processed += frequencyResults.processed;
      results.totals.failed += frequencyResults.failed;
      results.totals.errors.push(...frequencyResults.errors);
    }

    return NextResponse.json({
      success: true,
      ...results,
    });
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
 * GET /api/cron/settlement-requests - Health check for cron endpoint
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

  // Get current date info
  const now = new Date();
  const activeFrequencies = getActiveFrequencies(now);

  return NextResponse.json({
    status: "ok",
    endpoint: "/api/cron/settlement-requests",
    description: "Settlement file request scheduler",
    currentDate: now.toISOString(),
    activeFrequencies,
    actions: {
      all: "Process all active frequencies for current date",
      monthly: "Process monthly suppliers only",
      quarterly: "Process quarterly suppliers only",
      semi_annual: "Process semi-annual suppliers only",
      annual: "Process annual suppliers only",
      bi_weekly: "Process bi-weekly suppliers only",
      weekly: "Process weekly suppliers only",
    },
    usage: {
      method: "POST",
      queryParams: {
        action: "all | monthly | quarterly | semi_annual | annual | bi_weekly | weekly",
        dryRun: "true to simulate without sending emails",
        emailTemplateId: "optional template ID for file request emails",
      },
      authentication: "Bearer token in Authorization header (CRON_SECRET)",
    },
    schedulingNotes: {
      monthly: "Runs on 1st of every month",
      quarterly: "Runs on 1st of Jan, Apr, Jul, Oct",
      semi_annual: "Runs on 1st of Jan, Jul",
      annual: "Runs on 1st of Jan",
      bi_weekly: "Runs on 1st and 15th of every month",
      weekly: "Should be handled by separate weekly cron",
    },
  });
}
