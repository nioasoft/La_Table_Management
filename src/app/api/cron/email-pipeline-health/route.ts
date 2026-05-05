/**
 * GET /api/cron/email-pipeline-health
 *
 * Daily watchdog over the inbound email pipeline. Built after the
 * 2026-05-05 multi-day silent outage where Cibus, Tnbis, and HAAT all
 * broke and nobody noticed for five days because there was no active
 * signal — the gmail_sync_log accumulated `error_count > 0` rows but
 * neither Reut nor Asaf had a reason to look.
 *
 * The cron runs once a day, examines the last 24 hours of
 * gmail_sync_log + client_document, and emails alerts when:
 *
 *   • Any client has an error rate over `ERROR_RATE_THRESHOLD` (20%)
 *     across ≥3 runs (low-volume noise filtered out).
 *   • Any client that normally produces inbound documents has gone
 *     quiet for `QUIET_HOURS` (36h) without a single new doc.
 *   • Any (client, franchisee, period) has a commission_invoice with
 *     no matching client_report — or vice versa — for the most recent
 *     month, which historically signals one of the two attachments
 *     was silently dropped (Wolt File A/B regression).
 *
 * Recipients: ALERT_RECIPIENTS env var (comma-separated). Defaults to
 * asaf@giggsi.co.il if unset. Reut should be added to the env list.
 *
 * Cron path: /api/cron/email-pipeline-health (registered in vercel.json).
 *
 * IMPORTANT: Vercel Cron sends GET, never POST — see memory
 * gotcha_vercel_cron_get.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt, isNotNull, sql } from "drizzle-orm";
import { database } from "@/db";
import {
  client,
  clientDocument,
  franchisee,
  gmailSyncLog,
} from "@/db/schema";
import { startCronLog } from "@/lib/cron-logger";
import { sendDirectEmail } from "@/lib/email/service";

const TRACKED_CLIENT_CODES = ["CIBUS", "TENBIS", "HAAT", "WOLT", "MISHLOCHA"];
const ERROR_RATE_THRESHOLD = 0.2; // 20%
const MIN_RUNS_FOR_RATE = 3;
const QUIET_HOURS = 36;
const LOOKBACK_HOURS = 24;

/**
 * Clients we EXPECT to receive both a commission_invoice AND a
 * client_report per (franchisee, period). Cibus is intentionally
 * excluded — its commission invoice ("FW: החשבונית החודשית") is
 * forwarded manually by Reut on a different cadence than the daily
 * Pluxee דוח, so per-franchisee asymmetry is normal and would
 * otherwise create constant false-positive alerts.
 */
const BIDIRECTIONAL_CLIENT_CODES = new Set([
  "TENBIS",
  "HAAT",
  "WOLT",
  "MISHLOCHA",
]);

interface ClientStats {
  clientCode: string;
  totalRuns: number;
  failedRuns: number;
  errorRate: number;
  documentsCreated: number;
  hoursSinceLastDoc: number | null;
  lastErrorSubjects: string[];
}

interface MissingPair {
  clientCode: string;
  franchiseeName: string;
  periodMonth: number;
  periodYear: number;
  hasCommissionInvoice: boolean;
  hasClientReport: boolean;
}

interface HealthReport {
  generatedAt: string;
  lookbackHours: number;
  clients: ClientStats[];
  alerts: string[];
  missingPairs: MissingPair[];
}

async function gatherClientStats(): Promise<ClientStats[]> {
  const sinceLookback = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000);
  const sinceQuiet = new Date(Date.now() - QUIET_HOURS * 3600 * 1000);
  const stats: ClientStats[] = [];

  for (const code of TRACKED_CLIENT_CODES) {
    const runs = await database
      .select({
        id: gmailSyncLog.id,
        errorCount: gmailSyncLog.errorCount,
        documentsCreated: gmailSyncLog.documentsCreated,
        subject: gmailSyncLog.subject,
        runStartedAt: gmailSyncLog.runStartedAt,
      })
      .from(gmailSyncLog)
      .where(
        and(
          eq(gmailSyncLog.clientCode, code),
          gt(gmailSyncLog.runStartedAt, sinceLookback),
        ),
      );

    const totalRuns = runs.length;
    const failedRuns = runs.filter((r) => (r.errorCount ?? 0) > 0).length;
    const documentsCreated = runs.reduce(
      (sum, r) => sum + (r.documentsCreated ?? 0),
      0,
    );
    const errorRate = totalRuns > 0 ? failedRuns / totalRuns : 0;

    const lastErrorSubjects = runs
      .filter((r) => (r.errorCount ?? 0) > 0)
      .map((r) => r.subject ?? "(no subject)")
      .slice(0, 5);

    // How long since the most recent successful document of any kind for
    // this client? Use client_document.created_at joined to client.code.
    const lastDocRow = await database
      .select({ createdAt: clientDocument.createdAt })
      .from(clientDocument)
      .innerJoin(client, eq(client.id, clientDocument.clientId))
      .where(eq(client.code, code))
      .orderBy(sql`${clientDocument.createdAt} DESC`)
      .limit(1);

    const hoursSinceLastDoc = lastDocRow[0]?.createdAt
      ? Math.floor(
          (Date.now() - new Date(lastDocRow[0].createdAt).getTime()) /
            (3600 * 1000),
        )
      : null;

    void sinceQuiet;
    stats.push({
      clientCode: code,
      totalRuns,
      failedRuns,
      errorRate,
      documentsCreated,
      hoursSinceLastDoc,
      lastErrorSubjects,
    });
  }

  return stats;
}

async function findMissingPairs(): Promise<MissingPair[]> {
  // Most-recent FULL month — i.e. the one before the current month
  const now = new Date();
  let m = now.getMonth(); // 0-indexed → previous month
  let y = now.getFullYear();
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  // m here is human (1-12); pull all (client, franchisee) pairs that
  // produced *something* for that period and compare their document_type set.
  const rows = await database
    .select({
      clientCode: client.code,
      franchiseeName: franchisee.name,
      documentType: clientDocument.documentType,
    })
    .from(clientDocument)
    .innerJoin(client, eq(client.id, clientDocument.clientId))
    .innerJoin(franchisee, eq(franchisee.id, clientDocument.franchiseeId))
    .where(
      and(
        eq(clientDocument.periodMonth, m),
        eq(clientDocument.periodYear, y),
      ),
    );

  const grouped = new Map<
    string,
    { clientCode: string; franchiseeName: string; types: Set<string> }
  >();

  for (const r of rows) {
    if (!r.clientCode || !BIDIRECTIONAL_CLIENT_CODES.has(r.clientCode)) continue;
    const key = `${r.clientCode}|${r.franchiseeName}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        clientCode: r.clientCode,
        franchiseeName: r.franchiseeName,
        types: new Set<string>(),
      });
    }
    grouped.get(key)!.types.add(r.documentType);
  }

  const out: MissingPair[] = [];
  for (const value of grouped.values()) {
    const hasCommission = value.types.has("commission_invoice");
    const hasReport = value.types.has("client_report");
    if (!hasCommission || !hasReport) {
      out.push({
        clientCode: value.clientCode,
        franchiseeName: value.franchiseeName,
        periodMonth: m,
        periodYear: y,
        hasCommissionInvoice: hasCommission,
        hasClientReport: hasReport,
      });
    }
  }
  return out;
}

function buildAlerts(stats: ClientStats[], missingPairs: MissingPair[]): string[] {
  const alerts: string[] = [];

  for (const s of stats) {
    if (
      s.totalRuns >= MIN_RUNS_FOR_RATE &&
      s.errorRate > ERROR_RATE_THRESHOLD
    ) {
      const pct = Math.round(s.errorRate * 100);
      alerts.push(
        `${s.clientCode}: ${s.failedRuns}/${s.totalRuns} כשלונות ב-${LOOKBACK_HOURS} שעות אחרונות (${pct}% > ${Math.round(ERROR_RATE_THRESHOLD * 100)}%). דוגמאות: ${s.lastErrorSubjects.slice(0, 2).join(" | ")}`,
      );
    }
    if (s.hoursSinceLastDoc !== null && s.hoursSinceLastDoc > QUIET_HOURS) {
      alerts.push(
        `${s.clientCode}: שקט מעבר ל-${QUIET_HOURS} שעות (לא נוצר מסמך כבר ${s.hoursSinceLastDoc} שעות). אם הקליינט פעיל זה כנראה משמעותי.`,
      );
    }
  }

  // Group missing-pair alerts by client to avoid spamming
  const byClient = new Map<string, MissingPair[]>();
  for (const p of missingPairs) {
    if (!byClient.has(p.clientCode)) byClient.set(p.clientCode, []);
    byClient.get(p.clientCode)!.push(p);
  }
  for (const [code, pairs] of byClient.entries()) {
    const halfMissing = pairs.filter(
      (p) => p.hasCommissionInvoice !== p.hasClientReport,
    );
    if (halfMissing.length > 0) {
      alerts.push(
        `${code}: ${halfMissing.length} זכייני(ם) עם רק חצי מהמסמכים לחודש ${pairs[0].periodMonth}/${pairs[0].periodYear} — ${halfMissing
          .slice(0, 5)
          .map(
            (p) =>
              // Label the MISSING type, not the present one. Inverted in
              // the first version of this cron — caught by manual review
              // when Castra Tomayee Tnbis was tagged "דוח חסר" despite
              // a client_report row existing for April 2026.
              `${p.franchiseeName} (${!p.hasCommissionInvoice ? "עמלה" : "דוח"} חסר)`,
          )
          .join(", ")}.`,
      );
    }
  }

  return alerts;
}

function renderHealthReportHtml(report: HealthReport): string {
  const escape = (s: string): string =>
    s
      .replace(/&/g, "&amp;")
      .replace(/</g, "&lt;")
      .replace(/>/g, "&gt;");

  const alertSection =
    report.alerts.length > 0
      ? `<h2>התראות</h2><ul>${report.alerts
          .map((a) => `<li>${escape(a)}</li>`)
          .join("")}</ul>`
      : "<p>אין התראות פעילות. הצינור תקין.</p>";

  const tableRows = report.clients
    .map(
      (s) =>
        `<tr><td>${escape(s.clientCode)}</td><td style="text-align:center">${s.totalRuns}</td><td style="text-align:center">${s.failedRuns}</td><td style="text-align:center">${Math.round(s.errorRate * 100)}%</td><td style="text-align:center">${s.documentsCreated}</td><td style="text-align:center">${s.hoursSinceLastDoc ?? "—"}</td></tr>`,
    )
    .join("");

  return `<!DOCTYPE html><html dir="rtl" lang="he"><body style="font-family:Rubik,Arial,sans-serif">
<h1>בריאות צינור מיילים נכנסים</h1>
<p>טווח: ${report.lookbackHours} שעות אחרונות. נוצר: ${escape(report.generatedAt)}</p>
${alertSection}
<h2>סיכום לפי קליינט</h2>
<table border="1" cellpadding="6" cellspacing="0" style="border-collapse:collapse">
<thead><tr><th>קליינט</th><th>הרצות</th><th>כשלונות</th><th>אחוז</th><th>מסמכים נוצרו</th><th>שעות מאז דוח אחרון</th></tr></thead>
<tbody>${tableRows}</tbody>
</table>
<p style="color:#666;font-size:0.9em;margin-top:24px">דוח זה נשלח אוטומטית מ-/api/cron/email-pipeline-health. ערוך נמענים דרך משתנה הסביבה ALERT_RECIPIENTS.</p>
</body></html>`;
}

function renderHealthReportText(report: HealthReport): string {
  const lines: string[] = [];
  lines.push(`בריאות צינור מיילים נכנסים — ${report.lookbackHours} שעות אחרונות`);
  lines.push(`נוצר: ${report.generatedAt}`);
  lines.push("");
  if (report.alerts.length > 0) {
    lines.push("== התראות ==");
    for (const a of report.alerts) lines.push(`  • ${a}`);
  } else {
    lines.push("אין התראות פעילות. הצינור תקין.");
  }
  lines.push("");
  lines.push("== סיכום לפי קליינט ==");
  for (const s of report.clients) {
    lines.push(
      `  ${s.clientCode.padEnd(10)} runs=${s.totalRuns} failed=${s.failedRuns} (${Math.round(s.errorRate * 100)}%) docs=${s.documentsCreated} quiet=${s.hoursSinceLastDoc ?? "—"}h`,
    );
  }
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

export async function GET(request: NextRequest) {
  const url = new URL(request.url);
  const isManual = url.searchParams.get("source") === "manual";
  const skipEmail = url.searchParams.get("skip_email") === "true";

  const log = await startCronLog(
    "email-pipeline-health",
    isManual ? "manual" : "cron",
  );

  let alertCount = 0;
  let emailsSent = 0;
  let emailsFailed = 0;
  let errorMessage: string | undefined;

  try {
    const stats = await gatherClientStats();
    const missingPairs = await findMissingPairs();
    const alerts = buildAlerts(stats, missingPairs);
    alertCount = alerts.length;

    const report: HealthReport = {
      generatedAt: new Date().toISOString(),
      lookbackHours: LOOKBACK_HOURS,
      clients: stats,
      alerts,
      missingPairs,
    };

    const recipients = getRecipients();
    const shouldSend = alerts.length > 0 && !skipEmail;

    if (shouldSend) {
      const subjectPrefix = alerts.length > 0 ? `[התראה] ` : "";
      const subject = `${subjectPrefix}בריאות צינור מיילים — ${alerts.length} התראה(ות)`;
      const html = renderHealthReportHtml(report);
      const text = renderHealthReportText(report);

      for (const to of recipients) {
        const r = await sendDirectEmail({
          to,
          subject,
          html,
          text,
          entityType: "cron_health_report",
        });
        if (r.success) emailsSent++;
        else emailsFailed++;
      }
    }

    await log.complete({
      emailsSent,
      emailsFailed,
      totalProcessed: stats.length,
      totalFailed: alertCount,
      summary: {
        alerts,
        clients: stats.map((s) => ({
          code: s.clientCode,
          runs: s.totalRuns,
          failed: s.failedRuns,
          docs: s.documentsCreated,
          quietHours: s.hoursSinceLastDoc,
        })),
        missingPairCount: missingPairs.length,
        emailedRecipients: shouldSend ? recipients : [],
      },
    });

    return NextResponse.json({
      ok: true,
      alerts,
      stats,
      missingPairs,
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
