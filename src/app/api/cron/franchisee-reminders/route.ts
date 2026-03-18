import { NextRequest, NextResponse } from "next/server";
import { render } from "@react-email/components";
import { database } from "@/db";
import {
  franchiseeReminder,
  franchisee,
  franchiseeImportantDate,
  type FranchiseeReminderType,
  type ImportantDateType,
} from "@/db/schema";
import { eq, and, lte, or } from "drizzle-orm";
import {
  getPendingRemindersForNotification,
  markReminderAsSent,
  createFranchiseeReminder,
  type FranchiseeReminderWithFranchisee,
} from "@/data-access/franchiseeReminders";
import { getActiveFranchisees } from "@/data-access/franchisees";
import { sendDirectEmail } from "@/lib/email/service";
import { AgreementExpiryEmail } from "@/emails/agreement-expiry";
import { formatDateAsLocal } from "@/lib/date-utils";

/**
 * Franchisee Reminders Cron Job
 *
 * Manages contract/lease expiration reminders for franchisees.
 *
 * Auto-creates 3 reminders per expiry date:
 *   - 30 days before
 *   - 15 days before
 *   - On the day (0 days before)
 *
 * ALL reminders are sent ONLY to Reut (reutl@latableg.com), not to franchisees.
 *
 * "Handled" feature: When Reut marks a reminder as "handled" in the dashboard,
 * all related future reminders for that same expiry date are also marked as handled.
 *
 * Query params:
 * - action: "all" | "lease_option" | "franchise_agreement" | "custom"
 * - dryRun: "true" to simulate
 * - autoCreate: "true" to auto-create reminders from franchisee dates
 */

const ADMIN_EMAIL = "reutl@latableg.com";
const REMINDER_DAYS = [30, 15, 0]; // Days before expiry to send reminders
const LOOK_AHEAD_DAYS = 90;

// Get advance notice days for display in email (from franchisee data or default)
function getAdvanceNoticeDays(reminderType: FranchiseeReminderType): number {
  switch (reminderType) {
    case "lease_option":
      return 90; // Standard lease notice period
    case "franchise_agreement":
      return 60; // Standard franchise agreement notice
    default:
      return 30;
  }
}

// Send agreement expiry reminder email to Reut
async function sendExpiryReminderEmail(
  reminder: FranchiseeReminderWithFranchisee,
  dryRun: boolean
): Promise<{ success: boolean; error?: string }> {
  if (dryRun) return { success: true };

  const franchiseeName = reminder.franchisee?.name || "לא ידוע";
  const reminderDate = new Date(reminder.reminderDate);
  const today = new Date();
  const daysRemaining = Math.ceil(
    (reminderDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  const reminderTypeLabels: Record<FranchiseeReminderType, string> = {
    lease_option: "אופציית שכירות",
    franchise_agreement: "הסכם זיכיון",
    custom: "תזכורת",
  };

  const advanceNoticeDays = getAdvanceNoticeDays(reminder.reminderType);

  const html = await render(
    AgreementExpiryEmail({
      franchisee_name: franchiseeName,
      expiry_date: reminderDate.toLocaleDateString("he-IL"),
      advance_notice_days: String(advanceNoticeDays),
      reminder_type: reminderTypeLabels[reminder.reminderType],
      days_remaining: String(Math.max(0, daysRemaining)),
    })
  );
  const text = await render(
    AgreementExpiryEmail({
      franchisee_name: franchiseeName,
      expiry_date: reminderDate.toLocaleDateString("he-IL"),
      advance_notice_days: String(advanceNoticeDays),
      reminder_type: reminderTypeLabels[reminder.reminderType],
      days_remaining: String(Math.max(0, daysRemaining)),
    }),
    { plainText: true }
  );

  return sendDirectEmail({
    to: ADMIN_EMAIL,
    subject: `תזכורת: תפוגת ${reminderTypeLabels[reminder.reminderType]} - ${franchiseeName}`,
    html,
    text,
    entityType: "franchisee_reminder",
    entityId: reminder.id,
    metadata: {
      reminderId: reminder.id,
      franchiseeId: reminder.franchiseeId,
      reminderType: reminder.reminderType,
      daysRemaining,
    },
  });
}

// Auto-create reminders from franchisee date fields
// Creates 3 reminders per expiry date: 30, 15, 0 days before
async function autoCreateRemindersFromFranchisees(
  dryRun: boolean
): Promise<{ created: number; skipped: number; errors: string[] }> {
  const results = { created: 0, skipped: 0, errors: [] as string[] };
  const franchisees = await getActiveFranchisees();
  const today = new Date();

  for (const f of franchisees) {
    // Collect all expiry dates to check
    const expiryDates: { date: string; type: FranchiseeReminderType; label: string }[] = [];

    if (f.leaseOption1End) {
      expiryDates.push({ date: f.leaseOption1End, type: "lease_option", label: "אופציה 1" });
    }
    if (f.leaseOption2End) {
      expiryDates.push({ date: f.leaseOption2End, type: "lease_option", label: "אופציה 2" });
    }
    if (f.leaseOption3End) {
      expiryDates.push({ date: f.leaseOption3End, type: "lease_option", label: "אופציה 3" });
    }
    if (f.franchiseAgreementEnd) {
      expiryDates.push({ date: f.franchiseAgreementEnd, type: "franchise_agreement", label: "הסכם זיכיון" });
    }

    for (const expiry of expiryDates) {
      const expiryDate = new Date(expiry.date);
      const daysUntilExpiry = Math.ceil(
        (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      // Only create reminders for dates within the look-ahead window
      if (daysUntilExpiry < -30 || daysUntilExpiry > LOOK_AHEAD_DAYS + 30) {
        continue;
      }

      for (const daysBefore of REMINDER_DAYS) {
        const notificationDate = new Date(expiry.date);
        notificationDate.setDate(notificationDate.getDate() - daysBefore);

        // Skip if notification date is more than 30 days in the past
        const daysUntilNotification = Math.ceil(
          (notificationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );
        if (daysUntilNotification < -30) continue;

        // Check if reminder already exists for this franchisee + date + daysBefore
        const existing = await database
          .select({ id: franchiseeReminder.id })
          .from(franchiseeReminder)
          .where(
            and(
              eq(franchiseeReminder.franchiseeId, f.id),
              eq(franchiseeReminder.reminderType, expiry.type),
              eq(franchiseeReminder.reminderDate, expiry.date),
              eq(franchiseeReminder.daysBeforeNotification, daysBefore)
            )
          )
          .limit(1);

        if (existing.length > 0) {
          results.skipped++;
          continue;
        }

        if (dryRun) {
          results.created++;
          continue;
        }

        try {
          await createFranchiseeReminder({
            id: crypto.randomUUID(),
            franchiseeId: f.id,
            title: `תום ${expiry.label} - ${f.name}`,
            description: `${daysBefore === 0 ? "היום" : `${daysBefore} יום לפני`} תפוגת ${expiry.label} של סניף ${f.name}`,
            reminderType: expiry.type,
            reminderDate: expiry.date,
            daysBeforeNotification: daysBefore,
            notificationDate: formatDateAsLocal(notificationDate),
            recipients: [ADMIN_EMAIL],
            status: "pending",
            metadata: {
              expiryLabel: expiry.label,
              autoCreated: true,
            },
          });
          results.created++;
        } catch (error) {
          results.errors.push(
            `${f.name} ${expiry.label} (${daysBefore}d): ${
              error instanceof Error ? error.message : "Unknown error"
            }`
          );
        }
      }
    }
  }

  return results;
}

// Map important date types to reminder types
function mapDateTypeToReminderType(dateType: ImportantDateType): FranchiseeReminderType {
  switch (dateType) {
    case "franchise_agreement":
      return "franchise_agreement";
    case "rental_contract":
    case "lease_option":
      return "lease_option";
    case "custom":
    default:
      return "custom";
  }
}

// Auto-create reminders from franchisee_important_date table
async function autoCreateRemindersFromImportantDates(
  dryRun: boolean
): Promise<{ created: number; skipped: number; errors: string[] }> {
  const results = { created: 0, skipped: 0, errors: [] as string[] };
  const today = new Date();

  // Get all active important dates with their franchisee info
  const importantDates = await database
    .select({
      id: franchiseeImportantDate.id,
      franchiseeId: franchiseeImportantDate.franchiseeId,
      dateType: franchiseeImportantDate.dateType,
      endDate: franchiseeImportantDate.endDate,
      description: franchiseeImportantDate.description,
      customTypeName: franchiseeImportantDate.customTypeName,
    })
    .from(franchiseeImportantDate)
    .innerJoin(franchisee, eq(franchiseeImportantDate.franchiseeId, franchisee.id))
    .where(
      and(
        eq(franchiseeImportantDate.isActive, true),
        eq(franchisee.isActive, true)
      )
    );

  // Get franchisee names for labels
  const franchiseeNames = new Map<string, string>();
  const allFranchisees = await database
    .select({ id: franchisee.id, name: franchisee.name })
    .from(franchisee)
    .where(eq(franchisee.isActive, true));
  for (const f of allFranchisees) {
    franchiseeNames.set(f.id, f.name);
  }

  const dateTypeLabels: Record<string, string> = {
    franchise_agreement: "הסכם זיכיון",
    rental_contract: "חוזה שכירות",
    lease_option: "אופציית שכירות",
    custom: "תזכורת",
  };

  for (const impDate of importantDates) {
    const expiryDate = new Date(impDate.endDate);
    const daysUntilExpiry = Math.ceil(
      (expiryDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
    );

    // Only create reminders for dates within a reasonable window
    if (daysUntilExpiry < -30 || daysUntilExpiry > LOOK_AHEAD_DAYS + 30) {
      continue;
    }

    const reminderType = mapDateTypeToReminderType(impDate.dateType);
    const label = impDate.customTypeName || dateTypeLabels[impDate.dateType] || impDate.dateType;
    const franchiseeName = franchiseeNames.get(impDate.franchiseeId) || "לא ידוע";

    for (const daysBefore of REMINDER_DAYS) {
      const notificationDate = new Date(impDate.endDate);
      notificationDate.setDate(notificationDate.getDate() - daysBefore);

      const daysUntilNotification = Math.ceil(
        (notificationDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );
      if (daysUntilNotification < -30) continue;

      // Check if reminder already exists (match on franchisee + type + endDate + daysBefore)
      const existing = await database
        .select({ id: franchiseeReminder.id })
        .from(franchiseeReminder)
        .where(
          and(
            eq(franchiseeReminder.franchiseeId, impDate.franchiseeId),
            eq(franchiseeReminder.reminderType, reminderType),
            eq(franchiseeReminder.reminderDate, impDate.endDate),
            eq(franchiseeReminder.daysBeforeNotification, daysBefore)
          )
        )
        .limit(1);

      if (existing.length > 0) {
        results.skipped++;
        continue;
      }

      if (dryRun) {
        results.created++;
        continue;
      }

      try {
        await createFranchiseeReminder({
          id: crypto.randomUUID(),
          franchiseeId: impDate.franchiseeId,
          title: `תום ${label} - ${franchiseeName}`,
          description: `${daysBefore === 0 ? "היום" : `${daysBefore} יום לפני`} תפוגת ${label} של סניף ${franchiseeName}`,
          reminderType,
          reminderDate: impDate.endDate,
          daysBeforeNotification: daysBefore,
          notificationDate: formatDateAsLocal(notificationDate),
          recipients: [ADMIN_EMAIL],
          status: "pending",
          metadata: {
            importantDateId: impDate.id,
            expiryLabel: label,
            autoCreated: true,
            source: "important_dates",
          },
        });
        results.created++;
      } catch (error) {
        results.errors.push(
          `${franchiseeName} ${label} (${daysBefore}d): ${
            error instanceof Error ? error.message : "Unknown error"
          }`
        );
      }
    }
  }

  return results;
}

// Process pending reminders - send emails
async function processReminders(
  type: FranchiseeReminderType | "all",
  dryRun: boolean
): Promise<{
  processed: number;
  failed: number;
  emailsSent: number;
  errors: string[];
  reminders: { id: string; franchisee: string; type: string; daysBefore: number }[];
}> {
  const results = {
    processed: 0,
    failed: 0,
    emailsSent: 0,
    errors: [] as string[],
    reminders: [] as { id: string; franchisee: string; type: string; daysBefore: number }[],
  };

  const today = formatDateAsLocal(new Date());

  // Get pending reminders where notificationDate <= today AND status is pending
  // Also skip "handled" reminders
  const allPending = await getPendingRemindersForNotification();

  // Filter by type if specified
  const reminders = type === "all"
    ? allPending
    : allPending.filter((r) => r.reminderType === type);

  for (const reminder of reminders) {
    // Skip handled reminders (extra safety - getPendingRemindersForNotification already filters by status=pending)
    if (reminder.status === "handled" || reminder.status === "dismissed") {
      continue;
    }

    try {
      const sendResult = await sendExpiryReminderEmail(reminder, dryRun);

      if (sendResult.success) {
        if (!dryRun) {
          await markReminderAsSent(reminder.id);
        }
        results.processed++;
        results.emailsSent++;
        results.reminders.push({
          id: reminder.id,
          franchisee: reminder.franchisee?.name || "Unknown",
          type: reminder.reminderType,
          daysBefore: reminder.daysBeforeNotification,
        });
      } else {
        results.failed++;
        results.errors.push(
          `Reminder ${reminder.id}: ${sendResult.error}`
        );
      }
    } catch (error) {
      results.failed++;
      results.errors.push(
        `Reminder ${reminder.id}: ${
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
    const autoCreate = searchParams.get("autoCreate") === "true";

    interface ResultsType {
      timestamp: string;
      dryRun: boolean;
      autoCreate?: { created: number; skipped: number; errors: string[] };
      reminders?: {
        processed: number;
        failed: number;
        emailsSent: number;
        errors: string[];
        reminders: { id: string; franchisee: string; type: string; daysBefore: number }[];
      };
      totals: {
        processed: number;
        failed: number;
        emailsSent: number;
        created: number;
        errors: string[];
      };
    }

    const results: ResultsType = {
      timestamp: formatDateAsLocal(new Date()),
      dryRun,
      totals: { processed: 0, failed: 0, emailsSent: 0, created: 0, errors: [] },
    };

    // Auto-create reminders from both sources
    if (autoCreate) {
      // 1. From franchisee table fields (leaseOption1End, etc.)
      const fromFields = await autoCreateRemindersFromFranchisees(dryRun);
      // 2. From franchisee_important_date table
      const fromImportantDates = await autoCreateRemindersFromImportantDates(dryRun);

      results.autoCreate = {
        created: fromFields.created + fromImportantDates.created,
        skipped: fromFields.skipped + fromImportantDates.skipped,
        errors: [...fromFields.errors, ...fromImportantDates.errors],
      };
      results.totals.created += results.autoCreate.created;
      results.totals.errors.push(...results.autoCreate.errors);
    }

    // Process reminders
    const validTypes: (FranchiseeReminderType | "all")[] = [
      "all", "lease_option", "franchise_agreement", "custom",
    ];
    if (!validTypes.includes(action as FranchiseeReminderType | "all")) {
      return NextResponse.json(
        { error: "Invalid action. Use: all, lease_option, franchise_agreement, custom" },
        { status: 400 }
      );
    }

    const reminderType = action === "all" ? "all" : (action as FranchiseeReminderType);
    results.reminders = await processReminders(reminderType, dryRun);
    results.totals.processed += results.reminders.processed;
    results.totals.failed += results.reminders.failed;
    results.totals.emailsSent += results.reminders.emailsSent;
    results.totals.errors.push(...results.reminders.errors);

    return NextResponse.json({ success: true, ...results });
  } catch (error) {
    console.error("Error processing franchisee reminders cron job:", error);
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

  const pendingReminders = await getPendingRemindersForNotification();

  return NextResponse.json({
    status: "ok",
    endpoint: "/api/cron/franchisee-reminders",
    description: "Franchisee contract/lease reminder scheduler",
    currentDate: formatDateAsLocal(new Date()),
    statistics: {
      pendingRemindersTotal: pendingReminders.length,
    },
    reminderSchedule: {
      daysBeforeExpiry: REMINDER_DAYS,
      recipient: ADMIN_EMAIL,
      note: "All reminders sent to admin only, not to franchisees",
    },
    features: {
      autoCreate: "Creates 3 reminders (30/15/0 days) per expiry date",
      handled: "Marking as 'handled' stops future reminders for that date",
    },
  });
}
