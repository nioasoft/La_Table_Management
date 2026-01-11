import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getFranchiseeReminders,
  getFranchiseeRemindersByStatus,
  getFranchiseeRemindersByType,
  getFranchiseeRemindersByFranchisee,
  createFranchiseeReminder,
  getFranchiseeReminderStats,
  calculateNotificationDate,
} from "@/data-access/franchiseeReminders";
import { getFranchiseeById } from "@/data-access/franchisees";
import { randomUUID } from "crypto";
import type { FranchiseeReminderType, ReminderStatus } from "@/db/schema";

/**
 * GET /api/franchisee-reminders - Get all franchisee reminders (Admin/Super User only)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin or super_user
    const userRole = (session.user as typeof session.user & { role?: string })
      .role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status") as ReminderStatus | null;
    const type = searchParams.get("type") as FranchiseeReminderType | null;
    const franchiseeId = searchParams.get("franchiseeId");
    const includeStats = searchParams.get("stats") === "true";

    let reminders;

    if (status) {
      reminders = await getFranchiseeRemindersByStatus(status);
    } else if (type) {
      reminders = await getFranchiseeRemindersByType(type);
    } else if (franchiseeId) {
      reminders = await getFranchiseeRemindersByFranchisee(franchiseeId);
    } else {
      reminders = await getFranchiseeReminders();
    }

    const stats = includeStats ? await getFranchiseeReminderStats() : null;

    return NextResponse.json({ reminders, stats });
  } catch (error) {
    console.error("Error fetching franchisee reminders:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/franchisee-reminders - Create a new franchisee reminder (Admin/Super User only)
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin or super_user
    const userRole = (session.user as typeof session.user & { role?: string })
      .role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const {
      franchiseeId,
      title,
      description,
      reminderType,
      reminderDate,
      daysBeforeNotification = 30,
      recipients,
    } = body;

    // Validate required fields
    if (!franchiseeId || !title || !reminderType || !reminderDate || !recipients) {
      return NextResponse.json(
        { error: "Franchisee ID, title, reminder type, reminder date, and recipients are required" },
        { status: 400 }
      );
    }

    // Validate reminder type
    const validTypes: FranchiseeReminderType[] = ["lease_option", "franchise_agreement", "custom"];
    if (!validTypes.includes(reminderType)) {
      return NextResponse.json(
        { error: "Invalid reminder type. Must be lease_option, franchise_agreement, or custom" },
        { status: 400 }
      );
    }

    // Validate recipients is an array of emails
    if (!Array.isArray(recipients) || recipients.length === 0) {
      return NextResponse.json(
        { error: "Recipients must be a non-empty array of email addresses" },
        { status: 400 }
      );
    }

    // Validate franchisee exists
    const franchisee = await getFranchiseeById(franchiseeId);
    if (!franchisee) {
      return NextResponse.json(
        { error: "Franchisee not found" },
        { status: 404 }
      );
    }

    // Calculate notification date
    const notificationDate = calculateNotificationDate(reminderDate, daysBeforeNotification);

    const newReminder = await createFranchiseeReminder({
      id: randomUUID(),
      franchiseeId,
      title,
      description: description || null,
      reminderType,
      reminderDate,
      daysBeforeNotification,
      recipients,
      notificationDate,
      status: "pending",
      createdBy: session.user.id,
    });

    return NextResponse.json({ reminder: newReminder }, { status: 201 });
  } catch (error) {
    console.error("Error creating franchisee reminder:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
