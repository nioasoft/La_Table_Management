import { NextRequest, NextResponse } from "next/server";
import { render } from "@react-email/render";
import { and, eq, gte, lt } from "drizzle-orm";
import { database } from "@/db";
import { emailLog } from "@/db/schema";
import { sendDirectEmail } from "@/lib/email/service";
import { MonthlyUploadReminderEmail } from "@/emails/monthly-upload-reminder";
import { startCronLog } from "@/lib/cron-logger";
import { isIsraelWorkday } from "@/lib/israel-workday";

const RECIPIENT_EMAIL = "hadas@latableg.com";
const ENTITY_TYPE = "monthly_upload_reminder";

const HEBREW_MONTHS = [
  "ינואר",
  "פברואר",
  "מרץ",
  "אפריל",
  "מאי",
  "יוני",
  "יולי",
  "אוגוסט",
  "ספטמבר",
  "אוקטובר",
  "נובמבר",
  "דצמבר",
];

function previousMonthLabel(now: Date): string {
  const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
  return `${HEBREW_MONTHS[prev.getMonth()]} ${prev.getFullYear()}`;
}

function currentMonthKey(now: Date): string {
  const y = now.getFullYear();
  const m = String(now.getMonth() + 1).padStart(2, "0");
  return `${y}-${m}`;
}

async function alreadySentThisMonth(now: Date): Promise<boolean> {
  const monthStart = new Date(now.getFullYear(), now.getMonth(), 1);
  const nextMonthStart = new Date(now.getFullYear(), now.getMonth() + 1, 1);

  const existing = await database
    .select({ id: emailLog.id })
    .from(emailLog)
    .where(
      and(
        eq(emailLog.entityType, ENTITY_TYPE),
        eq(emailLog.toEmail, RECIPIENT_EMAIL),
        gte(emailLog.createdAt, monthStart),
        lt(emailLog.createdAt, nextMonthStart)
      )
    )
    .limit(1);

  return existing.length > 0;
}

async function handle(request: NextRequest) {
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
  const force = searchParams.get("force") === "true";

  const now = new Date();
  const monthKey = currentMonthKey(now);

  const cronLog = dryRun ? null : await startCronLog("monthly-upload-reminder");

  try {
    // Catch-up policy: send on the first workday of the month that the cron
    // actually fires on, not strictly the calendar's first workday. The
    // alreadySentThisMonth dedup guarantees a single send per month even
    // when Vercel fires the cron on multiple days. Skip non-workdays so the
    // reminder doesn't land in Hadas's inbox over the weekend.
    if (!force && !isIsraelWorkday(now)) {
      await cronLog?.complete({
        emailsSent: 0,
        totalSkipped: 1,
        summary: { reason: "not_workday", date: now.toISOString(), monthKey },
      });
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "not_workday",
        monthKey,
      });
    }

    if (!force && (await alreadySentThisMonth(now))) {
      await cronLog?.complete({
        emailsSent: 0,
        totalSkipped: 1,
        summary: { reason: "already_sent", monthKey },
      });
      return NextResponse.json({
        success: true,
        skipped: true,
        reason: "already_sent",
        monthKey,
      });
    }

    const baseUrl =
      process.env.NEXT_PUBLIC_APP_URL ||
      (process.env.VERCEL_URL ? `https://${process.env.VERCEL_URL}` : "http://localhost:3000");
    const uploadLink = `${baseUrl}/admin/clients/documents`;
    const periodLabel = previousMonthLabel(now);

    const emailVars = {
      recipient_name: "הדס",
      period_label: periodLabel,
      upload_link: uploadLink,
    };

    const html = await render(MonthlyUploadReminderEmail(emailVars));
    const text = await render(MonthlyUploadReminderEmail(emailVars), { plainText: true });

    if (dryRun) {
      return NextResponse.json({
        success: true,
        dryRun: true,
        to: RECIPIENT_EMAIL,
        periodLabel,
        uploadLink,
        monthKey,
      });
    }

    const result = await sendDirectEmail({
      to: RECIPIENT_EMAIL,
      subject: `תזכורת חודשית: העלאת דוח "חבר" ודוחות טאביט - ${periodLabel}`,
      html,
      text,
      entityType: ENTITY_TYPE,
      entityId: monthKey,
      metadata: { periodLabel, monthKey },
    });

    await cronLog?.complete(
      {
        emailsSent: result.success ? 1 : 0,
        emailsFailed: result.success ? 0 : 1,
        totalProcessed: 1,
        totalFailed: result.success ? 0 : 1,
        summary: { monthKey, periodLabel, to: RECIPIENT_EMAIL },
      },
      result.success ? undefined : result.error
    );

    return NextResponse.json({
      success: result.success,
      monthKey,
      periodLabel,
      to: RECIPIENT_EMAIL,
      messageId: result.messageId,
      error: result.error,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Unknown error";
    await cronLog?.complete(
      { emailsSent: 0, emailsFailed: 1, totalFailed: 1 },
      message
    );
    return NextResponse.json(
      { error: "Internal server error", message },
      { status: 500 }
    );
  }
}

export async function POST(request: NextRequest) {
  return handle(request);
}

export async function GET(request: NextRequest) {
  return handle(request);
}
