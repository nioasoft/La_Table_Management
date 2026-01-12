import { NextRequest, NextResponse } from "next/server";
import { database } from "@/db";
import {
  franchiseeReminder,
  franchisee,
  type FranchiseeReminder,
  type FranchiseeReminderType,
} from "@/db/schema";
import { eq, and, lte, or } from "drizzle-orm";
import {
  getPendingRemindersForNotification,
  markReminderAsSent,
  getFranchiseeRemindersByType,
  type FranchiseeReminderWithFranchisee,
} from "@/data-access/franchiseeReminders";
import { getFranchiseeById } from "@/data-access/franchisees";
import { sendEmailWithTemplateCode } from "@/lib/email/service";

/**
 * Franchisee Reminders Cron Job
 *
 * This endpoint processes franchisee reminders for:
 * - Lease option expiration dates
 * - Franchise agreement expiration dates
 * - Custom reminders
 *
 * Reminders are sent based on the notificationDate field which is calculated
 * from reminderDate - daysBeforeNotification.
 *
 * Query params:
 * - action: "all" | "lease_option" | "franchise_agreement" | "custom" (default: "all")
 * - dryRun: "true" to simulate without sending emails
 * - emailTemplateCode: Template code to use for reminder emails (default: "franchisee_reminder")
 *
 * Authentication:
 * This endpoint uses a secret token for authentication.
 * Set CRON_SECRET environment variable and pass it as Authorization header.
 */

// Get reminders due for notification by type
async function getRemindersDueByType(
  type: FranchiseeReminderType
): Promise<FranchiseeReminderWithFranchisee[]> {
  const today = new Date().toISOString().split("T")[0];

  const results = await database
    .select({
      reminder: franchiseeReminder,
      franchisee: {
        id: franchisee.id,
        name: franchisee.name,
        code: franchisee.code,
      },
    })
    .from(franchiseeReminder)
    .leftJoin(franchisee, eq(franchiseeReminder.franchiseeId, franchisee.id))
    .where(
      and(
        eq(franchiseeReminder.reminderType, type),
        eq(franchiseeReminder.status, "pending"),
        lte(franchiseeReminder.notificationDate, today)
      )
    );

  return results.map((r) => ({
    ...r.reminder,
    franchisee: r.franchisee,
    createdByUser: null,
  }));
}

// Send reminder email to all recipients
async function sendReminderEmails(
  reminder: FranchiseeReminderWithFranchisee,
  templateCode: string,
  dryRun: boolean = false
): Promise<{ success: boolean; sentCount: number; errors: string[] }> {
  const results = {
    success: true,
    sentCount: 0,
    errors: [] as string[],
  };

  const recipients = reminder.recipients as string[];
  if (!recipients || recipients.length === 0) {
    return { success: false, sentCount: 0, errors: ["No recipients configured"] };
  }

  // Get franchisee details for email context
  const franchiseeData = reminder.franchisee;

  // Format reminder type for display
  const reminderTypeLabels: Record<FranchiseeReminderType, string> = {
    lease_option: "אופציית חכירה",
    franchise_agreement: "הסכם זיכיון",
    custom: "תזכורת מותאמת",
  };

  // Calculate days remaining
  const reminderDate = new Date(reminder.reminderDate);
  const today = new Date();
  const daysRemaining = Math.ceil(
    (reminderDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
  );

  for (const recipientEmail of recipients) {
    try {
      if (dryRun) {
        results.sentCount++;
        continue;
      }

      const sendResult = await sendEmailWithTemplateCode(
        templateCode,
        {
          franchisee_name: franchiseeData?.name || "לא ידוע",
          franchisee_code: franchiseeData?.code || "",
          reminder_type: reminderTypeLabels[reminder.reminderType],
          reminder_title: reminder.title,
          reminder_description: reminder.description || "",
          reminder_date: new Date(reminder.reminderDate).toLocaleDateString(
            "he-IL"
          ),
          days_remaining: daysRemaining.toString(),
          days_before_notification: reminder.daysBeforeNotification.toString(),
        },
        {
          to: recipientEmail,
          entityType: "franchisee_reminder",
          entityId: reminder.id,
          metadata: {
            reminderId: reminder.id,
            franchiseeId: reminder.franchiseeId,
            reminderType: reminder.reminderType,
          },
        }
      );

      if (sendResult.success) {
        results.sentCount++;
      } else {
        results.errors.push(`${recipientEmail}: ${sendResult.error}`);
      }
    } catch (error) {
      results.errors.push(
        `${recipientEmail}: ${
          error instanceof Error ? error.message : "Unknown error"
        }`
      );
    }
  }

  results.success = results.sentCount > 0;
  return results;
}

// Process reminders by type
async function processRemindersByType(
  type: FranchiseeReminderType | "all",
  templateCode: string,
  dryRun: boolean = false
): Promise<{
  processed: number;
  failed: number;
  emailsSent: number;
  errors: string[];
  reminders: { id: string; franchisee: string; type: string }[];
}> {
  const results = {
    processed: 0,
    failed: 0,
    emailsSent: 0,
    errors: [] as string[],
    reminders: [] as { id: string; franchisee: string; type: string }[],
  };

  let reminders: FranchiseeReminderWithFranchisee[];

  if (type === "all") {
    reminders = await getPendingRemindersForNotification();
  } else {
    reminders = await getRemindersDueByType(type);
  }

  for (const reminder of reminders) {
    try {
      const sendResult = await sendReminderEmails(reminder, templateCode, dryRun);

      if (sendResult.success) {
        // Mark reminder as sent (unless dry run)
        if (!dryRun) {
          await markReminderAsSent(reminder.id);
        }

        results.processed++;
        results.emailsSent += sendResult.sentCount;
        results.reminders.push({
          id: reminder.id,
          franchisee: reminder.franchisee?.name || "Unknown",
          type: reminder.reminderType,
        });
      } else {
        results.failed++;
        results.errors.push(
          `Reminder ${reminder.id}: ${sendResult.errors.join(", ")}`
        );
      }

      // Add any partial errors
      if (sendResult.errors.length > 0 && sendResult.success) {
        results.errors.push(
          `Reminder ${reminder.id} (partial): ${sendResult.errors.join(", ")}`
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

// Auto-create reminders from franchisee date fields
async function autoCreateRemindersFromFranchisees(
  dryRun: boolean = false
): Promise<{
  created: number;
  skipped: number;
  errors: string[];
}> {
  const results = {
    created: 0,
    skipped: 0,
    errors: [] as string[],
  };

  // Get all active franchisees
  const { getActiveFranchisees } = await import("@/data-access/franchisees");
  const franchisees = await getActiveFranchisees();

  const today = new Date();
  const lookAheadDays = 90; // Create reminders for dates within 90 days
  const defaultDaysBefore = 30;

  for (const f of franchisees) {
    // Check lease option dates (1, 2, and 3)
    const leaseOptions = [
      { date: f.leaseOption1End, label: "אופציה 1" },
      { date: f.leaseOption2End, label: "אופציה 2" },
      { date: f.leaseOption3End, label: "אופציה 3" },
    ];

    for (const option of leaseOptions) {
      if (option.date) {
        const leaseDate = new Date(option.date);
        const daysUntil = Math.ceil(
          (leaseDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
        );

        if (daysUntil > 0 && daysUntil <= lookAheadDays + defaultDaysBefore) {
          // Check if reminder already exists
          const existingReminders = await getRemindersDueByType("lease_option");
          const alreadyExists = existingReminders.some(
            (r) =>
              r.franchiseeId === f.id &&
              r.reminderDate === option.date
          );

          if (!alreadyExists) {
            if (!dryRun) {
              const { createFranchiseeReminder } = await import(
                "@/data-access/franchiseeReminders"
              );
              const notificationDate = new Date(option.date);
              notificationDate.setDate(
                notificationDate.getDate() - defaultDaysBefore
              );

              await createFranchiseeReminder({
                id: crypto.randomUUID(),
                franchiseeId: f.id,
                title: `תום ${option.label} - ${f.name}`,
                description: `תאריך סיום ${option.label} של סניף ${f.name} מתקרב`,
                reminderType: "lease_option",
                reminderDate: option.date,
                daysBeforeNotification: defaultDaysBefore,
                notificationDate: notificationDate.toISOString().split("T")[0],
                recipients: [
                  f.primaryContactEmail ||
                    f.contactEmail ||
                    "admin@latable.co.il",
                ].filter(Boolean) as string[],
                status: "pending",
              });
            }
            results.created++;
          } else {
            results.skipped++;
          }
        }
      }
    }

    // Check franchise agreement end
    if (f.franchiseAgreementEnd) {
      const agreementDate = new Date(f.franchiseAgreementEnd);
      const daysUntil = Math.ceil(
        (agreementDate.getTime() - today.getTime()) / (1000 * 60 * 60 * 24)
      );

      if (daysUntil > 0 && daysUntil <= lookAheadDays + defaultDaysBefore) {
        // Check if reminder already exists
        const existingReminders = await getRemindersDueByType("franchise_agreement");
        const alreadyExists = existingReminders.some(
          (r) =>
            r.franchiseeId === f.id &&
            r.reminderDate === f.franchiseAgreementEnd
        );

        if (!alreadyExists) {
          if (!dryRun) {
            const { createFranchiseeReminder } = await import(
              "@/data-access/franchiseeReminders"
            );
            const notificationDate = new Date(f.franchiseAgreementEnd);
            notificationDate.setDate(
              notificationDate.getDate() - defaultDaysBefore
            );

            await createFranchiseeReminder({
              id: crypto.randomUUID(),
              franchiseeId: f.id,
              title: `תום הסכם זיכיון - ${f.name}`,
              description: `תאריך סיום הסכם הזיכיון של סניף ${f.name} מתקרב`,
              reminderType: "franchise_agreement",
              reminderDate: f.franchiseAgreementEnd,
              daysBeforeNotification: defaultDaysBefore,
              notificationDate: notificationDate.toISOString().split("T")[0],
              recipients: [
                f.primaryContactEmail ||
                  f.contactEmail ||
                  "admin@latable.co.il",
              ].filter(Boolean) as string[],
              status: "pending",
            });
          }
          results.created++;
        } else {
          results.skipped++;
        }
      }
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
    const templateCode =
      searchParams.get("emailTemplateCode") || "franchisee_reminder";
    const autoCreate = searchParams.get("autoCreate") === "true";

    interface ResultsType {
      timestamp: string;
      dryRun: boolean;
      autoCreate?: {
        created: number;
        skipped: number;
        errors: string[];
      };
      reminders?: {
        processed: number;
        failed: number;
        emailsSent: number;
        errors: string[];
        reminders: { id: string; franchisee: string; type: string }[];
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
      timestamp: new Date().toISOString(),
      dryRun,
      totals: {
        processed: 0,
        failed: 0,
        emailsSent: 0,
        created: 0,
        errors: [],
      },
    };

    // Auto-create reminders from franchisee dates if requested
    if (autoCreate) {
      results.autoCreate = await autoCreateRemindersFromFranchisees(dryRun);
      results.totals.created += results.autoCreate.created;
      results.totals.errors.push(...results.autoCreate.errors);
    }

    // Process reminders
    if (
      action === "all" ||
      action === "lease_option" ||
      action === "franchise_agreement" ||
      action === "custom"
    ) {
      const reminderType = action === "all" ? "all" : (action as FranchiseeReminderType);
      results.reminders = await processRemindersByType(
        reminderType,
        templateCode,
        dryRun
      );

      results.totals.processed += results.reminders.processed;
      results.totals.failed += results.reminders.failed;
      results.totals.emailsSent += results.reminders.emailsSent;
      results.totals.errors.push(...results.reminders.errors);
    } else {
      return NextResponse.json(
        {
          error:
            "Invalid action. Use: all, lease_option, franchise_agreement, custom",
        },
        { status: 400 }
      );
    }

    return NextResponse.json({
      success: true,
      ...results,
    });
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

/**
 * GET /api/cron/franchisee-reminders - Health check for cron endpoint
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

  // Get statistics
  const pendingReminders = await getPendingRemindersForNotification();
  const leaseReminders = await getRemindersDueByType("lease_option");
  const agreementReminders = await getRemindersDueByType("franchise_agreement");
  const customReminders = await getRemindersDueByType("custom");

  return NextResponse.json({
    status: "ok",
    endpoint: "/api/cron/franchisee-reminders",
    description: "Franchisee contract and lease reminder scheduler",
    statistics: {
      pendingRemindersTotal: pendingReminders.length,
      byType: {
        lease_option: leaseReminders.length,
        franchise_agreement: agreementReminders.length,
        custom: customReminders.length,
      },
    },
    actions: {
      all: "Process all pending reminders",
      lease_option: "Process lease option reminders only",
      franchise_agreement: "Process franchise agreement reminders only",
      custom: "Process custom reminders only",
    },
    usage: {
      method: "POST",
      queryParams: {
        action: "all | lease_option | franchise_agreement | custom",
        dryRun: "true to simulate without sending emails",
        emailTemplateCode:
          "template code to use (default: franchisee_reminder)",
        autoCreate:
          "true to auto-create reminders from franchisee dates (within 90 days)",
      },
      authentication: "Bearer token in Authorization header (CRON_SECRET)",
    },
    reminderTypes: {
      lease_option: "Reminders for lease option expiration dates",
      franchise_agreement: "Reminders for franchise agreement expiration dates",
      custom: "Custom reminders created manually",
    },
    notes: {
      notificationTiming:
        "Reminders are sent based on notificationDate = reminderDate - daysBeforeNotification",
      defaultDaysBefore: "30 days before the event date",
      autoCreate:
        "When enabled, automatically creates reminders for franchisees with leaseOptionEnd or franchiseAgreementEnd dates within 90 days",
    },
  });
}
