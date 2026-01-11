import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getFranchiseeReminderById,
  updateFranchiseeReminder,
  deleteFranchiseeReminder,
  markReminderAsSent,
  markReminderAsDismissed,
  calculateNotificationDate,
} from "@/data-access/franchiseeReminders";
import type { FranchiseeReminderType, ReminderStatus } from "@/db/schema";

interface RouteContext {
  params: Promise<{ reminderId: string }>;
}

/**
 * GET /api/franchisee-reminders/[reminderId] - Get a single reminder
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { reminderId } = await context.params;
    const reminder = await getFranchiseeReminderById(reminderId);

    if (!reminder) {
      return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
    }

    return NextResponse.json({ reminder });
  } catch (error) {
    console.error("Error fetching reminder:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/franchisee-reminders/[reminderId] - Update a reminder
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { reminderId } = await context.params;
    const existingReminder = await getFranchiseeReminderById(reminderId);

    if (!existingReminder) {
      return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
    }

    const body = await request.json();
    const {
      title,
      description,
      reminderType,
      reminderDate,
      daysBeforeNotification,
      recipients,
      status,
      action, // Special action field for mark as sent/dismissed
    } = body;

    // Handle special actions
    if (action === "send") {
      const updatedReminder = await markReminderAsSent(reminderId);
      return NextResponse.json({ reminder: updatedReminder });
    }

    if (action === "dismiss") {
      const updatedReminder = await markReminderAsDismissed(reminderId, session.user.id);
      return NextResponse.json({ reminder: updatedReminder });
    }

    // Validate reminder type if provided
    if (reminderType) {
      const validTypes: FranchiseeReminderType[] = ["lease_option", "franchise_agreement", "custom"];
      if (!validTypes.includes(reminderType)) {
        return NextResponse.json(
          { error: "Invalid reminder type. Must be lease_option, franchise_agreement, or custom" },
          { status: 400 }
        );
      }
    }

    // Validate status if provided
    if (status) {
      const validStatuses: ReminderStatus[] = ["pending", "sent", "acknowledged", "dismissed"];
      if (!validStatuses.includes(status)) {
        return NextResponse.json(
          { error: "Invalid status" },
          { status: 400 }
        );
      }
    }

    // Validate recipients if provided
    if (recipients && (!Array.isArray(recipients) || recipients.length === 0)) {
      return NextResponse.json(
        { error: "Recipients must be a non-empty array of email addresses" },
        { status: 400 }
      );
    }

    // Calculate notification date if reminder date or days before changes
    let notificationDate = undefined;
    if (reminderDate || daysBeforeNotification !== undefined) {
      const dateToUse = reminderDate || existingReminder.reminderDate;
      const daysToUse = daysBeforeNotification !== undefined
        ? daysBeforeNotification
        : existingReminder.daysBeforeNotification;
      notificationDate = calculateNotificationDate(dateToUse, daysToUse);
    }

    const updateData: Record<string, unknown> = {};
    if (title !== undefined) updateData.title = title;
    if (description !== undefined) updateData.description = description;
    if (reminderType !== undefined) updateData.reminderType = reminderType;
    if (reminderDate !== undefined) updateData.reminderDate = reminderDate;
    if (daysBeforeNotification !== undefined) updateData.daysBeforeNotification = daysBeforeNotification;
    if (recipients !== undefined) updateData.recipients = recipients;
    if (status !== undefined) updateData.status = status;
    if (notificationDate !== undefined) updateData.notificationDate = notificationDate;

    const updatedReminder = await updateFranchiseeReminder(reminderId, updateData);

    return NextResponse.json({ reminder: updatedReminder });
  } catch (error) {
    console.error("Error updating reminder:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/franchisee-reminders/[reminderId] - Delete a reminder
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { reminderId } = await context.params;
    const deleted = await deleteFranchiseeReminder(reminderId);

    if (!deleted) {
      return NextResponse.json({ error: "Reminder not found" }, { status: 404 });
    }

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error deleting reminder:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
