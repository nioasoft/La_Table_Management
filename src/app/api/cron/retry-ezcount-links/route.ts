/**
 * GET /api/cron/retry-ezcount-links
 *
 * ezcount mails its "[העתק] חשבונית מס" copy the moment a document is issued,
 * but can withhold the PDF behind the link until the document has its מספר
 * הקצאה. When a franchisee's tax-authority access lapses that takes days:
 * all nine King Kong copies of 30/09–02/10/2026 failed on arrival ("ללא קבצים
 * מצורפים ולא נמצאו לינקים להורדה" — the link was there, the download was not)
 * and the PDFs only became downloadable on 11–12/10. The webhook tries once,
 * so the Mishloha slots stayed empty until they were filled by hand — wrongly.
 *
 * Daily, this replays every failed inbound email of the last RETRY_DAYS that
 * died on a download while carrying an ezcount document link, through the
 * replay handler — the same shared pipeline as the live webhook; never fork
 * it. An email that lands a document, or finds it already in the system, is
 * marked completed and leaves the set; the rest are retried tomorrow.
 *
 * Cron path registered in vercel.json (daily, before email-pipeline-health,
 * so the health check reports only what is still missing). ?dry=true lists
 * the candidates without replaying.
 *
 * IMPORTANT: Vercel Cron sends GET, never POST.
 */
import { NextRequest, NextResponse } from "next/server";
import { and, eq, gt, inArray, isNotNull, like, sql } from "drizzle-orm";
import { database } from "@/db";
import { gmailSyncLog } from "@/db/schema";
import { startCronLog } from "@/lib/cron-logger";
import { POST as replayInbound } from "@/app/api/admin/replay-inbound/route";

export const maxDuration = 300;

/** ezcount held the King Kong PDFs 12 days; a month leaves room for worse. */
const RETRY_DAYS = 30;
const MAX_PER_RUN = 20;
const EZCOUNT_LINK = "%files.ezcount.co.il/front/documents/get/%";
/** The webhook's "nothing downloaded" error — see email-inbound/route.ts. */
const DOWNLOAD_FAILED = "%ולא נמצאו לינקים להורדה%";

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
  const dryRun = url.searchParams.get("dry") === "true";
  const log = await startCronLog(
    "retry-ezcount-links",
    url.searchParams.get("source") === "manual" ? "manual" : "cron",
  );

  try {
    const since = new Date(Date.now() - RETRY_DAYS * 24 * 3600 * 1000);
    const rows = await database
      .selectDistinct({ emailId: gmailSyncLog.emailId })
      .from(gmailSyncLog)
      .where(
        and(
          eq(gmailSyncLog.status, "failed"),
          gt(gmailSyncLog.runStartedAt, since),
          isNotNull(gmailSyncLog.emailId),
          like(gmailSyncLog.bodyExcerpt, EZCOUNT_LINK),
          sql`${gmailSyncLog.errorDetails}::text like ${DOWNLOAD_FAILED}`,
        ),
      )
      .limit(MAX_PER_RUN);
    const emailIds = rows.map((r) => r.emailId as string);

    if (dryRun || emailIds.length === 0) {
      await log.complete({ totalProcessed: 0, summary: { dryRun, candidates: emailIds } });
      return NextResponse.json({ ok: true, dryRun, candidates: emailIds });
    }

    const res = await replayInbound(
      new NextRequest(new URL("/api/admin/replay-inbound", url), {
        method: "POST",
        headers: { authorization: `Bearer ${cronSecret}` },
        body: JSON.stringify({ emailIds }),
      }),
    );
    const { outcomes = [] } = (await res.json()) as {
      outcomes?: Array<{ emailId: string; status: string; error?: string }>;
    };

    // "skipped" = the document is already in the system by another route.
    const recovered = outcomes
      .filter((o) => o.status === "ok" || o.status === "skipped")
      .map((o) => o.emailId);
    if (recovered.length > 0) {
      await database
        .update(gmailSyncLog)
        .set({
          status: "completed",
          errorCount: 0,
          errorDetails: sql`coalesce(${gmailSyncLog.errorDetails}, '[]'::jsonb) || ${JSON.stringify([
            "נקלט בניסיון חוזר (retry-ezcount-links)",
          ])}::jsonb`,
        })
        .where(and(inArray(gmailSyncLog.emailId, recovered), eq(gmailSyncLog.status, "failed")));
    }

    const stillFailing = outcomes.filter((o) => !recovered.includes(o.emailId));
    await log.complete({
      totalProcessed: emailIds.length,
      totalSkipped: recovered.length,
      totalFailed: stillFailing.length,
      summary: { recovered, stillFailing },
    });
    return NextResponse.json({ ok: true, recovered, stillFailing });
  } catch (err: unknown) {
    const message = err instanceof Error ? err.message : String(err);
    console.error("[retry-ezcount-links] failed:", message);
    await log.complete({ totalFailed: 1 }, message);
    return NextResponse.json({ ok: false, error: "שגיאה בניסיון החוזר" }, { status: 500 });
  }
}
