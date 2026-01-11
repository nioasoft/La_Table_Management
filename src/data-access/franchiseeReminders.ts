import { database } from "@/db";
import {
  franchiseeReminder,
  franchisee,
  user,
  type FranchiseeReminder,
  type CreateFranchiseeReminderData,
  type UpdateFranchiseeReminderData,
  type FranchiseeReminderType,
  type ReminderStatus,
} from "@/db/schema";
import { eq, desc, and, sql, lte, gte, or } from "drizzle-orm";

/**
 * Franchisee Reminder with franchisee information
 */
export type FranchiseeReminderWithFranchisee = FranchiseeReminder & {
  franchisee: {
    id: string;
    name: string;
    code: string;
  } | null;
  createdByUser?: {
    name: string;
    email: string;
  } | null;
};

/**
 * Get all franchisee reminders with franchisee info
 */
export async function getFranchiseeReminders(): Promise<FranchiseeReminderWithFranchisee[]> {
  const results = await database
    .select({
      reminder: franchiseeReminder,
      franchisee: {
        id: franchisee.id,
        name: franchisee.name,
        code: franchisee.code,
      },
      createdByUserName: user.name,
      createdByUserEmail: user.email,
    })
    .from(franchiseeReminder)
    .leftJoin(franchisee, eq(franchiseeReminder.franchiseeId, franchisee.id))
    .leftJoin(user, eq(franchiseeReminder.createdBy, user.id))
    .orderBy(desc(franchiseeReminder.createdAt));

  return results.map((r) => ({
    ...r.reminder,
    franchisee: r.franchisee,
    createdByUser: r.createdByUserName
      ? { name: r.createdByUserName, email: r.createdByUserEmail! }
      : null,
  }));
}

/**
 * Get reminders by status
 */
export async function getFranchiseeRemindersByStatus(
  status: ReminderStatus
): Promise<FranchiseeReminderWithFranchisee[]> {
  const results = await database
    .select({
      reminder: franchiseeReminder,
      franchisee: {
        id: franchisee.id,
        name: franchisee.name,
        code: franchisee.code,
      },
      createdByUserName: user.name,
      createdByUserEmail: user.email,
    })
    .from(franchiseeReminder)
    .leftJoin(franchisee, eq(franchiseeReminder.franchiseeId, franchisee.id))
    .leftJoin(user, eq(franchiseeReminder.createdBy, user.id))
    .where(eq(franchiseeReminder.status, status))
    .orderBy(desc(franchiseeReminder.reminderDate));

  return results.map((r) => ({
    ...r.reminder,
    franchisee: r.franchisee,
    createdByUser: r.createdByUserName
      ? { name: r.createdByUserName, email: r.createdByUserEmail! }
      : null,
  }));
}

/**
 * Get reminders by type
 */
export async function getFranchiseeRemindersByType(
  type: FranchiseeReminderType
): Promise<FranchiseeReminderWithFranchisee[]> {
  const results = await database
    .select({
      reminder: franchiseeReminder,
      franchisee: {
        id: franchisee.id,
        name: franchisee.name,
        code: franchisee.code,
      },
      createdByUserName: user.name,
      createdByUserEmail: user.email,
    })
    .from(franchiseeReminder)
    .leftJoin(franchisee, eq(franchiseeReminder.franchiseeId, franchisee.id))
    .leftJoin(user, eq(franchiseeReminder.createdBy, user.id))
    .where(eq(franchiseeReminder.reminderType, type))
    .orderBy(desc(franchiseeReminder.reminderDate));

  return results.map((r) => ({
    ...r.reminder,
    franchisee: r.franchisee,
    createdByUser: r.createdByUserName
      ? { name: r.createdByUserName, email: r.createdByUserEmail! }
      : null,
  }));
}

/**
 * Get reminders for a specific franchisee
 */
export async function getFranchiseeRemindersByFranchisee(
  franchiseeId: string
): Promise<FranchiseeReminderWithFranchisee[]> {
  const results = await database
    .select({
      reminder: franchiseeReminder,
      franchisee: {
        id: franchisee.id,
        name: franchisee.name,
        code: franchisee.code,
      },
      createdByUserName: user.name,
      createdByUserEmail: user.email,
    })
    .from(franchiseeReminder)
    .leftJoin(franchisee, eq(franchiseeReminder.franchiseeId, franchisee.id))
    .leftJoin(user, eq(franchiseeReminder.createdBy, user.id))
    .where(eq(franchiseeReminder.franchiseeId, franchiseeId))
    .orderBy(desc(franchiseeReminder.reminderDate));

  return results.map((r) => ({
    ...r.reminder,
    franchisee: r.franchisee,
    createdByUser: r.createdByUserName
      ? { name: r.createdByUserName, email: r.createdByUserEmail! }
      : null,
  }));
}

/**
 * Get pending reminders that are due for notification
 */
export async function getPendingRemindersForNotification(): Promise<FranchiseeReminderWithFranchisee[]> {
  const today = new Date().toISOString().split("T")[0];

  const results = await database
    .select({
      reminder: franchiseeReminder,
      franchisee: {
        id: franchisee.id,
        name: franchisee.name,
        code: franchisee.code,
      },
      createdByUserName: user.name,
      createdByUserEmail: user.email,
    })
    .from(franchiseeReminder)
    .leftJoin(franchisee, eq(franchiseeReminder.franchiseeId, franchisee.id))
    .leftJoin(user, eq(franchiseeReminder.createdBy, user.id))
    .where(
      and(
        eq(franchiseeReminder.status, "pending"),
        lte(franchiseeReminder.notificationDate, today)
      )
    )
    .orderBy(franchiseeReminder.notificationDate);

  return results.map((r) => ({
    ...r.reminder,
    franchisee: r.franchisee,
    createdByUser: r.createdByUserName
      ? { name: r.createdByUserName, email: r.createdByUserEmail! }
      : null,
  }));
}

/**
 * Get a single reminder by ID
 */
export async function getFranchiseeReminderById(
  id: string
): Promise<FranchiseeReminderWithFranchisee | null> {
  const results = await database
    .select({
      reminder: franchiseeReminder,
      franchisee: {
        id: franchisee.id,
        name: franchisee.name,
        code: franchisee.code,
      },
      createdByUserName: user.name,
      createdByUserEmail: user.email,
    })
    .from(franchiseeReminder)
    .leftJoin(franchisee, eq(franchiseeReminder.franchiseeId, franchisee.id))
    .leftJoin(user, eq(franchiseeReminder.createdBy, user.id))
    .where(eq(franchiseeReminder.id, id))
    .limit(1);

  if (results.length === 0) return null;

  return {
    ...results[0].reminder,
    franchisee: results[0].franchisee,
    createdByUser: results[0].createdByUserName
      ? { name: results[0].createdByUserName, email: results[0].createdByUserEmail! }
      : null,
  };
}

/**
 * Create a new franchisee reminder
 */
export async function createFranchiseeReminder(
  data: CreateFranchiseeReminderData
): Promise<FranchiseeReminder> {
  const [newReminder] = (await database
    .insert(franchiseeReminder)
    .values(data)
    .returning()) as unknown as FranchiseeReminder[];
  return newReminder;
}

/**
 * Update an existing franchisee reminder
 */
export async function updateFranchiseeReminder(
  id: string,
  data: UpdateFranchiseeReminderData
): Promise<FranchiseeReminder | null> {
  const results = (await database
    .update(franchiseeReminder)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(franchiseeReminder.id, id))
    .returning()) as unknown as FranchiseeReminder[];
  return results[0] || null;
}

/**
 * Delete a franchisee reminder
 */
export async function deleteFranchiseeReminder(id: string): Promise<boolean> {
  const result = await database
    .delete(franchiseeReminder)
    .where(eq(franchiseeReminder.id, id));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Mark a reminder as sent
 */
export async function markReminderAsSent(
  id: string
): Promise<FranchiseeReminder | null> {
  const results = (await database
    .update(franchiseeReminder)
    .set({
      status: "sent",
      sentAt: new Date(),
      updatedAt: new Date(),
    })
    .where(eq(franchiseeReminder.id, id))
    .returning()) as unknown as FranchiseeReminder[];
  return results[0] || null;
}

/**
 * Mark a reminder as dismissed
 */
export async function markReminderAsDismissed(
  id: string,
  dismissedBy: string
): Promise<FranchiseeReminder | null> {
  const results = (await database
    .update(franchiseeReminder)
    .set({
      status: "dismissed",
      dismissedAt: new Date(),
      dismissedBy,
      updatedAt: new Date(),
    })
    .where(eq(franchiseeReminder.id, id))
    .returning()) as unknown as FranchiseeReminder[];
  return results[0] || null;
}

/**
 * Get reminder statistics
 */
export async function getFranchiseeReminderStats(): Promise<{
  total: number;
  pending: number;
  sent: number;
  dismissed: number;
  byType: { type: FranchiseeReminderType; count: number }[];
  upcomingThisWeek: number;
  upcomingThisMonth: number;
}> {
  const allReminders = await getFranchiseeReminders();

  const today = new Date();
  const oneWeekFromNow = new Date(today.getTime() + 7 * 24 * 60 * 60 * 1000);
  const oneMonthFromNow = new Date(today.getTime() + 30 * 24 * 60 * 60 * 1000);

  const stats = {
    total: allReminders.length,
    pending: 0,
    sent: 0,
    dismissed: 0,
    byType: [] as { type: FranchiseeReminderType; count: number }[],
    upcomingThisWeek: 0,
    upcomingThisMonth: 0,
  };

  const typeCounts: Record<FranchiseeReminderType, number> = {
    lease_option: 0,
    franchise_agreement: 0,
    custom: 0,
  };

  for (const reminder of allReminders) {
    // Count by status
    switch (reminder.status) {
      case "pending":
        stats.pending++;
        break;
      case "sent":
        stats.sent++;
        break;
      case "dismissed":
        stats.dismissed++;
        break;
    }

    // Count by type
    typeCounts[reminder.reminderType]++;

    // Count upcoming reminders
    if (reminder.status === "pending" && reminder.notificationDate) {
      const notificationDate = new Date(reminder.notificationDate);
      if (notificationDate <= oneWeekFromNow && notificationDate >= today) {
        stats.upcomingThisWeek++;
      }
      if (notificationDate <= oneMonthFromNow && notificationDate >= today) {
        stats.upcomingThisMonth++;
      }
    }
  }

  stats.byType = Object.entries(typeCounts).map(([type, count]) => ({
    type: type as FranchiseeReminderType,
    count,
  }));

  return stats;
}

/**
 * Helper function to calculate notification date from reminder date and days before
 */
export function calculateNotificationDate(
  reminderDate: string,
  daysBeforeNotification: number
): string {
  const date = new Date(reminderDate);
  date.setDate(date.getDate() - daysBeforeNotification);
  return date.toISOString().split("T")[0];
}

/**
 * Get upcoming reminders for dashboard widget
 * Returns pending reminders with upcoming notification dates (within daysAhead)
 * Sorted by notification date ascending (soonest first)
 */
export async function getUpcomingRemindersForDashboard(
  daysAhead: number = 30,
  limit: number = 10
): Promise<FranchiseeReminderWithFranchisee[]> {
  const today = new Date();
  const todayStr = today.toISOString().split("T")[0];
  const futureDate = new Date(today.getTime() + daysAhead * 24 * 60 * 60 * 1000);
  const futureDateStr = futureDate.toISOString().split("T")[0];

  const results = await database
    .select({
      reminder: franchiseeReminder,
      franchisee: {
        id: franchisee.id,
        name: franchisee.name,
        code: franchisee.code,
      },
      createdByUserName: user.name,
      createdByUserEmail: user.email,
    })
    .from(franchiseeReminder)
    .leftJoin(franchisee, eq(franchiseeReminder.franchiseeId, franchisee.id))
    .leftJoin(user, eq(franchiseeReminder.createdBy, user.id))
    .where(
      and(
        eq(franchiseeReminder.status, "pending"),
        or(
          // Include reminders with notification date in the range
          and(
            gte(franchiseeReminder.notificationDate, todayStr),
            lte(franchiseeReminder.notificationDate, futureDateStr)
          ),
          // Also include overdue reminders (notification date before today)
          lte(franchiseeReminder.notificationDate, todayStr)
        )
      )
    )
    .orderBy(franchiseeReminder.notificationDate)
    .limit(limit);

  return results.map((r) => ({
    ...r.reminder,
    franchisee: r.franchisee,
    createdByUser: r.createdByUserName
      ? { name: r.createdByUserName, email: r.createdByUserEmail! }
      : null,
  }));
}
