/**
 * GET /api/cron/inbound-review-summary
 *
 * Layer 3 daily summary — sends Reut a once-a-day Hebrew email with
 * everything that flowed through `/api/clients/email-inbound` in the
 * last 24 hours: counts per status, the per-row list of failed /
 * needs_review items, and a link to the inbox dashboard.
 *
 * Closes the loop on Reut's recurring "did the email arrive?" WhatsApp:
 * after this cron runs daily, she gets a single morning digest she can
 * review at her own pace, instead of finding out via reconciliation that
 * something silently failed days earlier.
 *
 * Cron path: /api/cron/inbound-review-summary (registered in vercel.json).
 *
 * IMPORTANT: Vercel Cron sends GET, never POST — see memory
 * gotcha_vercel_cron_get.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, desc, gte, inArray, sql } from "drizzle-orm";
import { database } from "@/db";
import {
  inboundReviewQueue,
  type InboundReviewQueue,
} from "@/db/schema";
import { startCronLog } from "@/lib/cron-logger";
import { sendDirectEmail } from "@/lib/email/service";

const LOOKBACK_HOURS = 24;
const STUCK_HOURS = 24; // failed/needs_review older than this → flagged as stuck

interface SummaryReport {
  generatedAt: string;
  lookbackHours: number;
  counts: {
    total: number;
    autoCommitted: number;
    failed: number;
    needsReview: number;
    rejected: number;
  };
  pendingItems: Array<{
    id: string;
    receivedAt: string | null;
    clientCode: string | null;
    subject: string | null;
    proposedFranchiseeName: string | null;
    failureReason: string | null;
    fileUrl: string | null;
    ageHours: number;
  }>;
  stuckCount: number;
}

async function gatherCounts(since: Date): Promise<SummaryReport["counts"]> {
  const rows = await database
    .select({
      status: inboundReviewQueue.status,
      count: sql<number>`count(*)::int`,
    })
    .from(inboundReviewQueue)
    .where(gte(inboundReviewQueue.createdAt, since))
    .groupBy(inboundReviewQueue.status);

  const m: Record<string, number> = {};
  for (const r of rows) m[r.status] = r.count;
  return {
    total: Object.values(m).reduce((a, b) => a + b, 0),
    autoCommitted: m.auto_committed ?? 0,
    failed: m.failed ?? 0,
    needsReview: m.needs_review ?? 0,
    rejected: m.rejected ?? 0,
  };
}

async function gatherPendingItems(): Promise<SummaryReport["pendingItems"]> {
  // Show ALL currently-unresolved rows regardless of age — Reut needs to
  // see Sunday's failures on Tuesday, not just last night's.
  const rows: InboundReviewQueue[] = await database
    .select()
    .from(inboundReviewQueue)
    .where(inArray(inboundReviewQueue.status, ["failed", "needs_review"]))
    .orderBy(desc(inboundReviewQueue.createdAt))
    .limit(50);

  const now = Date.now();
  return rows.map((r) => ({
    id: r.id,
    receivedAt: r.emailReceivedAt
      ? r.emailReceivedAt.toISOString()
      : r.createdAt.toISOString(),
    clientCode: r.clientCode,
    subject: r.emailSubject,
    proposedFranchiseeName: r.proposedFranchiseeName,
    failureReason: r.failureReason,
    fileUrl: r.fileUrl,
    ageHours: Math.floor((now - r.createdAt.getTime()) / (3600 * 1000)),
  }));
}

function escapeHtml(s: string): string {
  return s
    .replace(/&/g, "&amp;")
    .replace(/</g, "&lt;")
    .replace(/>/g, "&gt;")
    .replace(/"/g, "&quot;");
}

function formatDateTimeIL(iso: string): string {
  return new Date(iso).toLocaleString("he-IL", {
    day: "2-digit",
    month: "2-digit",
    year: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
  });
}

function renderHtml(report: SummaryReport, dashboardUrl: string): string {
  const c = report.counts;
  const itemsHtml =
    report.pendingItems.length === 0
      ? `<p style="color:#16a34a">אין רשומות שדורשות סקירה כרגע 🎉</p>`
      : `
        <table style="border-collapse:collapse;width:100%;font-size:0.9em" dir="rtl">
          <thead style="background:#f3f4f6">
            <tr>
              <th style="text-align:right;padding:6px;border:1px solid #e5e7eb">התקבל</th>
              <th style="text-align:right;padding:6px;border:1px solid #e5e7eb">ספק</th>
              <th style="text-align:right;padding:6px;border:1px solid #e5e7eb">נושא</th>
              <th style="text-align:right;padding:6px;border:1px solid #e5e7eb">זכיין מוצע</th>
              <th style="text-align:right;padding:6px;border:1px solid #e5e7eb">סיבה</th>
              <th style="text-align:right;padding:6px;border:1px solid #e5e7eb">גיל</th>
            </tr>
          </thead>
          <tbody>
            ${report.pendingItems
              .map((item) => {
                const stuck = item.ageHours >= STUCK_HOURS;
                const ageLabel = stuck
                  ? `<strong style="color:#dc2626">${item.ageHours} ש'</strong>`
                  : `${item.ageHours} ש'`;
                return `
                  <tr>
                    <td style="padding:6px;border:1px solid #e5e7eb;white-space:nowrap">${
                      item.receivedAt ? formatDateTimeIL(item.receivedAt) : "—"
                    }</td>
                    <td style="padding:6px;border:1px solid #e5e7eb">${escapeHtml(item.clientCode ?? "—")}</td>
                    <td style="padding:6px;border:1px solid #e5e7eb">${escapeHtml((item.subject ?? "—").slice(0, 80))}</td>
                    <td style="padding:6px;border:1px solid #e5e7eb">${escapeHtml(item.proposedFranchiseeName ?? "—")}</td>
                    <td style="padding:6px;border:1px solid #e5e7eb;color:#dc2626">${escapeHtml((item.failureReason ?? "—").slice(0, 80))}</td>
                    <td style="padding:6px;border:1px solid #e5e7eb">${ageLabel}</td>
                  </tr>
                `;
              })
              .join("")}
          </tbody>
        </table>
      `;

  const stuckBanner =
    report.stuckCount > 0
      ? `<div style="background:#fef3c7;border-right:4px solid #f59e0b;padding:8px 12px;margin:12px 0">
           <strong>⚠️ ${report.stuckCount}</strong> רשומות תקועות מעל ${STUCK_HOURS} שעות וטרם נסקרו.
         </div>`
      : "";

  return `<!doctype html>
<html dir="rtl" lang="he"><body style="font-family:Rubik,Arial,sans-serif;color:#111;max-width:900px;margin:0 auto;padding:16px">
  <h2>תיבת מיילים נכנסים — סיכום ${report.lookbackHours} שעות אחרונות</h2>
  <p style="color:#666">${formatDateTimeIL(report.generatedAt)}</p>

  ${stuckBanner}

  <div style="display:flex;gap:12px;flex-wrap:wrap;margin:16px 0">
    <div style="flex:1;min-width:140px;padding:12px;border:1px solid #e5e7eb;border-radius:6px">
      <div style="color:#666;font-size:0.85em">סך הכל</div>
      <div style="font-size:1.6em;font-weight:bold">${c.total}</div>
    </div>
    <div style="flex:1;min-width:140px;padding:12px;border:1px solid #d1fae5;background:#ecfdf5;border-radius:6px">
      <div style="color:#065f46;font-size:0.85em">אושרו אוטומטית</div>
      <div style="font-size:1.6em;font-weight:bold;color:#065f46">${c.autoCommitted}</div>
    </div>
    <div style="flex:1;min-width:140px;padding:12px;border:1px solid #fecaca;background:#fef2f2;border-radius:6px">
      <div style="color:#991b1b;font-size:0.85em">נכשלו</div>
      <div style="font-size:1.6em;font-weight:bold;color:#991b1b">${c.failed}</div>
    </div>
    <div style="flex:1;min-width:140px;padding:12px;border:1px solid #fde68a;background:#fffbeb;border-radius:6px">
      <div style="color:#92400e;font-size:0.85em">ממתינים לסקירה</div>
      <div style="font-size:1.6em;font-weight:bold;color:#92400e">${c.needsReview}</div>
    </div>
  </div>

  <h3>רשומות שדורשות סקירה</h3>
  ${itemsHtml}

  <p style="margin-top:24px">
    <a href="${dashboardUrl}" style="background:#1f2937;color:#fff;padding:10px 16px;border-radius:6px;text-decoration:none;display:inline-block">
      פתח את התיבה במערכת ←
    </a>
  </p>

  <p style="color:#666;font-size:0.85em;margin-top:24px">
    דוח זה נשלח אוטומטית מ-/api/cron/inbound-review-summary פעם ביום.
    ערוך נמענים דרך משתנה הסביבה ALERT_RECIPIENTS.
  </p>
</body></html>`;
}

function renderText(report: SummaryReport, dashboardUrl: string): string {
  const c = report.counts;
  const lines: string[] = [];
  lines.push(`תיבת מיילים נכנסים — ${report.lookbackHours} שעות אחרונות`);
  lines.push(`נוצר: ${report.generatedAt}`);
  lines.push("");
  lines.push(
    `סך הכל: ${c.total}  |  אושרו: ${c.autoCommitted}  |  נכשלו: ${c.failed}  |  ממתינים: ${c.needsReview}  |  נדחו: ${c.rejected}`,
  );
  if (report.stuckCount > 0) {
    lines.push("");
    lines.push(`⚠️ ${report.stuckCount} רשומות תקועות מעל ${STUCK_HOURS} שעות`);
  }
  lines.push("");
  lines.push("== רשומות שדורשות סקירה ==");
  if (report.pendingItems.length === 0) {
    lines.push("  אין");
  } else {
    for (const item of report.pendingItems) {
      lines.push(
        `  [${item.ageHours}ש'] ${item.clientCode ?? "?"}  ${(item.subject ?? "—").slice(0, 60)}`,
      );
      if (item.failureReason)
        lines.push(`    סיבה: ${item.failureReason.slice(0, 80)}`);
    }
  }
  lines.push("");
  lines.push(`לסקירה במערכת: ${dashboardUrl}`);
  return lines.join("\n");
}

function getRecipients(): string[] {
  const fromEnv = process.env.ALERT_RECIPIENTS;
  if (fromEnv && fromEnv.trim().length > 0) {
    return fromEnv
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean);
  }
  return ["asaf@giggsi.co.il"];
}

function getDashboardUrl(): string {
  const base =
    process.env.NEXT_PUBLIC_APP_URL ||
    process.env.NEXTAUTH_URL ||
    "https://www.latable.co.il";
  return `${base.replace(/\/$/, "")}/admin/clients/inbound-review`;
}

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const isManual = url.searchParams.get("source") === "manual";
  const skipEmail = url.searchParams.get("skip_email") === "true";

  const log = await startCronLog(
    "inbound-review-summary",
    isManual ? "manual" : "cron",
  );

  let emailsSent = 0;
  let emailsFailed = 0;
  let errorMessage: string | undefined;

  try {
    const since = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000);
    const stuckCutoff = new Date(Date.now() - STUCK_HOURS * 3600 * 1000);

    const [counts, pendingItems] = await Promise.all([
      gatherCounts(since),
      gatherPendingItems(),
    ]);

    const stuckCount = pendingItems.filter(
      (p) => new Date(p.receivedAt ?? new Date()).getTime() < stuckCutoff.getTime(),
    ).length;

    const report: SummaryReport = {
      generatedAt: new Date().toISOString(),
      lookbackHours: LOOKBACK_HOURS,
      counts,
      pendingItems,
      stuckCount,
    };

    // Skip the email when there's literally nothing to report — no traffic
    // and no pending items. Avoids cluttering Reut's inbox on weekends /
    // holidays where no inbound emails arrived.
    const hasContent = counts.total > 0 || pendingItems.length > 0;

    const recipients = getRecipients();
    const shouldSend = hasContent && !skipEmail;

    if (shouldSend) {
      const dashboardUrl = getDashboardUrl();
      const subjectPrefix =
        pendingItems.length > 0 ? `[${pendingItems.length} ממתינים] ` : "";
      const subject = `${subjectPrefix}תיבת מיילים נכנסים — ${counts.autoCommitted}/${counts.total} עברו`;
      const html = renderHtml(report, dashboardUrl);
      const text = renderText(report, dashboardUrl);

      for (const to of recipients) {
        const r = await sendDirectEmail({
          to,
          subject,
          html,
          text,
          entityType: "cron_inbound_summary",
        });
        if (r.success) emailsSent++;
        else emailsFailed++;
      }
    }

    await log.complete({
      emailsSent,
      emailsFailed,
      totalProcessed: counts.total,
      totalFailed: pendingItems.length,
      summary: {
        counts,
        pendingCount: pendingItems.length,
        stuckCount,
        sent: shouldSend,
        emailedRecipients: shouldSend ? recipients : [],
      },
    });

    return NextResponse.json({
      ok: true,
      counts,
      pendingCount: pendingItems.length,
      stuckCount,
      emailsSent,
      emailsFailed,
    });
  } catch (err: unknown) {
    errorMessage = err instanceof Error ? err.message : String(err);
    await log.complete({ totalFailed: 1 }, errorMessage);
    return NextResponse.json(
      { ok: false, error: errorMessage },
      { status: 500 },
    );
  }
}
