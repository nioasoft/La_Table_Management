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
 *   • Any journal-entry client_report over the allocation threshold
 *     with no מספר הקצאה — column K of the journal-entries export goes
 *     out empty and only Reut ever sees it (10bis July-2026).
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
import { and, eq, gt, isNotNull, isNull, sql } from "drizzle-orm";
import { database } from "@/db";
import {
  client,
  clientDocument,
  franchisee,
  gmailSyncLog,
} from "@/db/schema";
import { startCronLog } from "@/lib/cron-logger";
import { sendDirectEmail } from "@/lib/email/service";
import {
  ALLOCATION_NUMBER_THRESHOLD,
  isAllocationNumberMissing,
} from "@/lib/allocation-number";
import { tenbisUsesJournalEntries } from "@/data-access/client-reconciliation-approval";

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
  hoursSinceLastInbound: number | null;
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

interface TabitDivergence {
  clientCode: string;
  franchiseeName: string;
  periodMonth: number;
  periodYear: number;
  reportAmount: number;
  tabitAmount: number;
  divergencePct: number;
}

interface HealthReport {
  generatedAt: string;
  lookbackHours: number;
  clients: ClientStats[];
  alerts: string[];
  missingPairs: MissingPair[];
  tabitDivergences: TabitDivergence[];
  missingAllocations: MissingAllocation[];
}

async function gatherClientStats(): Promise<ClientStats[]> {
  const sinceLookback = new Date(Date.now() - LOOKBACK_HOURS * 3600 * 1000);
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

    // Liveness is measured on INBOUND EMAIL, not on documents — see the
    // quiet-alert note in buildAlerts.
    const lastInboundRow = await database
      .select({ runStartedAt: gmailSyncLog.runStartedAt })
      .from(gmailSyncLog)
      .where(eq(gmailSyncLog.clientCode, code))
      .orderBy(sql`${gmailSyncLog.runStartedAt} DESC`)
      .limit(1);

    const hoursSinceLastInbound = lastInboundRow[0]?.runStartedAt
      ? Math.floor(
          (Date.now() - new Date(lastInboundRow[0].runStartedAt).getTime()) /
            (3600 * 1000),
        )
      : null;

    stats.push({
      clientCode: code,
      totalRuns,
      failedRuns,
      errorRate,
      documentsCreated,
      hoursSinceLastDoc,
      hoursSinceLastInbound,
      lastErrorSubjects,
    });
  }

  return stats;
}

/**
 * Most-recent FULL month — i.e. the one before the current month.
 * Returns a human month (1-12), never `toISOString()` arithmetic.
 */
function previousFullMonth(): { m: number; y: number } {
  const now = new Date();
  let m = now.getMonth(); // 0-indexed → already the previous month as 1-12
  let y = now.getFullYear();
  if (m === 0) {
    m = 12;
    y -= 1;
  }
  return { m, y };
}

async function findMissingPairs(): Promise<MissingPair[]> {
  const { m, y } = previousFullMonth();
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

/**
 * Cross-check every platform report against Tabit for the same
 * (client, franchisee, period).
 *
 * Tabit is the POS — it independently knows what each branch actually sold
 * through each delivery platform, so it is the only ground truth we hold that
 * does not come from the platform itself. Every silent loss found in the
 * 2026-08-11 audit was visible here and nowhere else:
 *
 *   • WOLT / קינג קונג מוצקין 7/2026 — 53.9%. Wolt split July into two
 *     payouts; the second (₪114,404) was refused by the overwrite guard
 *     because the DB holds one client_report per franchisee-month, so the
 *     stored figure was half the month. No other check could see this: the
 *     report/invoice pair was complete, the parse succeeded, nothing failed.
 *   • TENBIS / נתנזון עזריאלי 7/2026 — 169.9%. פט ויני עזריאלי's report
 *     landed on נתנזון (shared ח.פ, no customer number on the document).
 *   • CIBUS / קינג קונג כרמיאל 5/2026 — 100%. The daily-snapshot overwrite
 *     that zeroed the May Cibus dataset. This check would have caught it.
 *
 * Threshold calibrated on May–July 2026 (all clients, all franchisees):
 * genuine noise — VAT treatment, delivery-fee handling, cutoff timing —
 * tops out at ~10%; every real incident sits at 30% or above. 25% leaves
 * clear air on both sides.
 *
 * MIN_TABIT_AMOUNT guards the denominator: a branch with a few hundred
 * shekels of platform sales swings wildly in percent terms and is not worth
 * waking anyone for.
 */
const TABIT_DIVERGENCE_THRESHOLD = 0.25;
const MIN_TABIT_AMOUNT = 1000;

async function findTabitDivergences(): Promise<TabitDivergence[]> {
  const { m, y } = previousFullMonth();

  const rows = await database
    .select({
      clientCode: client.code,
      franchiseeName: franchisee.name,
      documentType: clientDocument.documentType,
      totalAmount: clientDocument.totalAmount,
    })
    .from(clientDocument)
    .innerJoin(client, eq(client.id, clientDocument.clientId))
    .innerJoin(franchisee, eq(franchisee.id, clientDocument.franchiseeId))
    .where(
      and(
        eq(clientDocument.periodMonth, m),
        eq(clientDocument.periodYear, y),
        isNotNull(clientDocument.totalAmount),
      ),
    );

  const grouped = new Map<
    string,
    {
      clientCode: string;
      franchiseeName: string;
      report: number | null;
      tabit: number | null;
    }
  >();

  for (const r of rows) {
    if (!r.clientCode) continue;
    const amount = Number(r.totalAmount);
    if (!Number.isFinite(amount)) continue;

    const key = `${r.clientCode}|${r.franchiseeName}`;
    if (!grouped.has(key)) {
      grouped.set(key, {
        clientCode: r.clientCode,
        franchiseeName: r.franchiseeName,
        report: null,
        tabit: null,
      });
    }
    const entry = grouped.get(key)!;
    if (r.documentType === "client_report") entry.report = amount;
    if (r.documentType === "tabit_report") entry.tabit = amount;
  }

  const out: TabitDivergence[] = [];
  for (const e of grouped.values()) {
    if (e.report === null || e.tabit === null) continue; // missing-pair territory
    if (e.tabit < MIN_TABIT_AMOUNT) continue;
    const divergence = Math.abs(e.report - e.tabit) / e.tabit;
    if (divergence <= TABIT_DIVERGENCE_THRESHOLD) continue;
    out.push({
      clientCode: e.clientCode,
      franchiseeName: e.franchiseeName,
      periodMonth: m,
      periodYear: y,
      reportAmount: e.report,
      tabitAmount: e.tabit,
      divergencePct: Math.round(divergence * 1000) / 10,
    });
  }
  return out.sort((a, b) => b.divergencePct - a.divergencePct);
}

/**
 * Journal-entry invoices that legally must carry a מספר הקצאה but don't.
 *
 * The allocation number is column K of the per-franchisee journal-entries
 * Hashavshevet export, and it is read off the client_report — the tax invoice
 * the FRANCHISEE issued to the platform. When extraction breaks, nothing
 * fails: the document saves, the amounts are right, the export builds, and
 * column K is simply empty. Reut is the only detector, one line at a time.
 *
 * That is exactly how 10bis lost every July-2026 allocation (Reut 2026-08-12):
 * from the July period the TENBIS client_report slot holds the franchisee's
 * ezcount invoice instead of 10bis's transaction report, and the report parser
 * had no anchors for that layout. Fixed at the parser; this is the net that
 * catches the NEXT layout change, whichever platform makes it.
 *
 * HEVER is excluded: its client_report is a bank-transfer xlsx, never a tax
 * invoice, and its journal rows are built to leave K empty. TENBIS counts only
 * from the period its self-billed cutover took effect.
 */
interface MissingAllocation {
  clientCode: string;
  franchiseeName: string;
  periodMonth: number;
  periodYear: number;
  amount: number;
}

const ALLOCATION_EXEMPT_CLIENT_CODES = new Set(["HEVER"]);

async function findMissingAllocations(): Promise<MissingAllocation[]> {
  const { m, y } = previousFullMonth();

  const rows = await database
    .select({
      clientCode: client.code,
      franchiseeName: franchisee.name,
      totalAmount: clientDocument.totalAmount,
    })
    .from(clientDocument)
    .innerJoin(client, eq(client.id, clientDocument.clientId))
    .innerJoin(franchisee, eq(franchisee.id, clientDocument.franchiseeId))
    .where(
      and(
        eq(clientDocument.periodMonth, m),
        eq(clientDocument.periodYear, y),
        eq(clientDocument.documentType, "client_report"),
        eq(client.journalEntryGeneration, true),
        isNull(clientDocument.allocationNumber),
      ),
    );

  const out: MissingAllocation[] = [];
  for (const r of rows) {
    if (!r.clientCode) continue;
    if (ALLOCATION_EXEMPT_CLIENT_CODES.has(r.clientCode)) continue;
    if (r.clientCode === "TENBIS" && !tenbisUsesJournalEntries(m, y)) continue;
    const amount = Number(r.totalAmount);
    if (!isAllocationNumberMissing(amount, null)) continue;
    out.push({
      clientCode: r.clientCode,
      franchiseeName: r.franchiseeName,
      periodMonth: m,
      periodYear: y,
      amount,
    });
  }
  return out.sort((a, b) => b.amount - a.amount);
}

function buildAlerts(
  stats: ClientStats[],
  missingPairs: MissingPair[],
  tabitDivergences: TabitDivergence[],
  missingAllocations: MissingAllocation[],
): string[] {
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
    // Quiet alert = "the pipeline is dead", which is what this cron was built
    // for (the 2026-05-05 five-day silent outage). It used to fire on
    // `hoursSinceLastDoc`, but every tracked client is a MONTHLY publisher:
    // documents arrive in a burst at month-end and nothing comes for the next
    // ~25 days. So the alert fired for all 5 clients nearly every day —
    // 100% false positives over the 10 days audited on 2026-08-11 — which
    // buried the missing-pair alerts below that carry the real signal.
    //
    // Inbound EMAIL, by contrast, does flow continuously (daily Pluxee
    // snapshots, ezcount copies, platform notifications). Silence there is a
    // genuine "webhook/routing is broken" signal. Per-period completeness is
    // covered by the missing-pair alerts, which is the right tool for
    // "the month's documents never showed up".
    if (
      s.hoursSinceLastInbound !== null &&
      s.hoursSinceLastInbound > QUIET_HOURS
    ) {
      alerts.push(
        `${s.clientCode}: לא נקלט אף מייל נכנס מעל ${QUIET_HOURS} שעות (${s.hoursSinceLastInbound} שעות). ייתכן שהניתוב/webhook שבור.`,
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

  const fmt = (n: number): string =>
    `₪${n.toLocaleString("he-IL", { maximumFractionDigits: 0 })}`;

  for (const d of tabitDivergences) {
    alerts.push(
      `${d.clientCode} / ${d.franchiseeName} ${d.periodMonth}/${d.periodYear}: פער ${d.divergencePct}% מול טאבית — דוח ${fmt(d.reportAmount)} מול טאבית ${fmt(d.tabitAmount)}. בדוק אם הדוח חלקי, שויך לזכיין הלא נכון, או נדרס.`,
    );
  }

  // Grouped per client — one broken layout hits every branch at once.
  const allocByClient = new Map<string, MissingAllocation[]>();
  for (const a of missingAllocations) {
    if (!allocByClient.has(a.clientCode)) allocByClient.set(a.clientCode, []);
    allocByClient.get(a.clientCode)!.push(a);
  }
  for (const [code, rows] of allocByClient.entries()) {
    alerts.push(
      `${code}: ${rows.length} חשבונית(ות) מעל ${fmt(ALLOCATION_NUMBER_THRESHOLD)} ללא מספר הקצאה לחודש ${rows[0].periodMonth}/${rows[0].periodYear} — עמודה K בייצוא פקודות היומן תצא ריקה. ${rows
        .slice(0, 5)
        .map((r) => `${r.franchiseeName} (${fmt(r.amount)})`)
        .join(", ")}.`,
    );
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
    const tabitDivergences = await findTabitDivergences();
    const missingAllocations = await findMissingAllocations();
    const alerts = buildAlerts(
      stats,
      missingPairs,
      tabitDivergences,
      missingAllocations,
    );
    alertCount = alerts.length;

    const report: HealthReport = {
      generatedAt: new Date().toISOString(),
      lookbackHours: LOOKBACK_HOURS,
      clients: stats,
      alerts,
      missingPairs,
      tabitDivergences,
      missingAllocations,
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
        missingAllocationCount: missingAllocations.length,
        emailedRecipients: shouldSend ? recipients : [],
      },
    });

    return NextResponse.json({
      ok: true,
      alerts,
      stats,
      missingPairs,
      missingAllocations,
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
