/**
 * GET /api/cron/build-reconciliation-sessions
 *
 * Builds a reconciliation session for every (supplier × period) that has an
 * approved supplier file but no active session.
 *
 * Until now a session only came into being when someone clicked "התחל התאמה"
 * on that exact supplier+period. Nothing surfaced the periods nobody clicked,
 * so months sat un-reconciled until Reut happened to notice (מיטלנד April and
 * May 2026 were invisible for weeks). This closes the loop: files land, the
 * session is waiting the next morning.
 *
 * Only approved / auto-approved files are built — a file still in review may
 * still be rejected and replaced. A period that already has an active session
 * is skipped, so this is safe to re-run and self-heals missed days.
 *
 * Second pass: stale sessions with no human work are rebuilt (the safety net
 * for the after-response rebuild the stale markers schedule — a failure, a
 * script, a marker outside a request). Stale sessions WITH human work are
 * left for Reut's "בנה מחדש" — see humanWorkReason.
 *
 * Cron path registered in vercel.json (daily 04:30, before the morning
 * request/reminder crons). Add ?dry=true to preview without writing.
 *
 * IMPORTANT: Vercel Cron sends GET, never POST.
 */
import { NextRequest, NextResponse } from "next/server";
import {
  createReconciliationSession,
  getPeriodsWithoutSession,
} from "@/data-access/reconciliation-v2";
import {
  autoRebuildStaleSessions,
  getAutomationUserId,
} from "@/data-access/reconciliation-auto-rebuild";
import { startCronLog } from "@/lib/cron-logger";

/** Statuses that mean "this file is final enough to reconcile against". */
const BUILDABLE_FILE_STATUSES = new Set(["approved", "auto_approved"]);

/**
 * Ceiling per run. A backlog larger than this is drained over the following
 * days rather than in one burst — and the skipped count is logged, never
 * silently dropped.
 */
const MAX_PER_RUN = 25;

export async function GET(request: NextRequest) {
  const cronSecret = process.env.CRON_SECRET;
  if (!cronSecret) {
    console.error("CRON_SECRET must be configured");
    return NextResponse.json({ error: "Server misconfigured" }, { status: 503 });
  }
  if (request.headers.get("authorization") !== `Bearer ${cronSecret}`) {
    return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
  }

  const url = new URL(request.url);
  const isManual = url.searchParams.get("source") === "manual";
  const dryRun = url.searchParams.get("dry") === "true";

  const log = await startCronLog(
    "build-reconciliation-sessions",
    isManual ? "manual" : "cron"
  );

  let created = 0;
  let failed = 0;

  try {
    const adminId = await getAutomationUserId();

    if (!adminId) {
      await log.complete({ totalProcessed: 0 }, "no active admin user to attribute sessions to");
      return NextResponse.json(
        { error: "no active admin user found" },
        { status: 500 }
      );
    }

    const periods = await getPeriodsWithoutSession();
    const buildable = periods.filter(
      (p) => p.periodStartDate && p.periodEndDate && BUILDABLE_FILE_STATUSES.has(p.fileStatus)
    );
    const batch = buildable.slice(0, MAX_PER_RUN);
    const deferred = buildable.length - batch.length;

    const results: Array<{ supplier: string; period: string; ok: boolean; detail?: string }> = [];

    for (const p of batch) {
      const period = `${p.periodStartDate}_${p.periodEndDate}`;
      if (dryRun) {
        results.push({ supplier: p.supplierName, period, ok: true, detail: "dry-run" });
        continue;
      }
      try {
        const session = await createReconciliationSession(
          p.supplierId,
          p.supplierFileId,
          p.periodStartDate!,
          p.periodEndDate!,
          adminId,
          p.supplierFileIds
        );
        if (session) {
          created++;
          results.push({ supplier: p.supplierName, period, ok: true });
        } else {
          failed++;
          results.push({ supplier: p.supplierName, period, ok: false, detail: "returned null" });
        }
      } catch (error) {
        failed++;
        results.push({
          supplier: p.supplierName,
          period,
          ok: false,
          detail: error instanceof Error ? error.message : "unknown error",
        });
      }
    }

    const rebuild = await autoRebuildStaleSessions("all", adminId, {
      dryRun,
      limit: MAX_PER_RUN,
    });
    failed += rebuild.failed.length;

    await log.complete({
      totalProcessed: created + (dryRun ? 0 : rebuild.rebuilt.length),
      totalFailed: failed,
      totalSkipped: deferred + rebuild.deferred,
      summary: {
        candidates: buildable.length,
        deferredToNextRun: deferred,
        results,
        staleRebuild: rebuild,
      },
    });

    return NextResponse.json({
      success: true,
      dryRun,
      candidates: buildable.length,
      created,
      failed,
      deferredToNextRun: deferred,
      results,
      staleRebuild: rebuild,
    });
  } catch (error) {
    const message = error instanceof Error ? error.message : "unknown error";
    console.error("[build-reconciliation-sessions] failed:", error);
    await log.complete({ totalProcessed: created, totalFailed: failed }, message);
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
