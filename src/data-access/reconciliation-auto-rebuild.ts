/**
 * Auto-rebuild of stale reconciliation sessions that hold no human work.
 *
 * The markers in reconciliation-v2 (markSupplierSessionsStale /
 * markFranchiseeSessionsStale) schedule this right after the response, so a
 * re-upload never leaves Reut on frozen numbers. The nightly
 * build-reconciliation-sessions cron sweeps whatever that missed (a failed
 * rebuild, a script, a marker outside a request). Sessions with human work
 * stay stale and keep the "בנה מחדש" banner — see humanWorkReason.
 */
import { after } from "next/server";
import { and, asc, count, eq, inArray, isNotNull, isNull } from "drizzle-orm";
import { database } from "@/db";
import {
  reconciliationComparison,
  reconciliationReviewQueue,
  reconciliationSession,
  user,
} from "@/db/schema";
import { humanWorkReason } from "@/lib/reconciliation-auto-rebuild";
import { rebuildReconciliationSession } from "@/data-access/reconciliation-v2";

export type AutoRebuildReport = {
  rebuilt: Array<{ from: string; to: string }>;
  kept: Array<{ id: string; reason: string }>;
  failed: Array<{ id: string; error: string }>;
  /** Safe sessions left for the next run because of `limit`. */
  deferred: number;
};

/**
 * A change that lands while a rebuild is reading leaves the new run stale
 * (rebuildReconciliationSession carries the flag over) — rebuild it again,
 * a bounded number of times.
 */
const MAX_PASSES = 3;

/** createdBy is an FK to user — automatic work is attributed to the oldest active admin. */
export async function getAutomationUserId(): Promise<string | null> {
  const [admin] = await database
    .select({ id: user.id })
    .from(user)
    .where(and(inArray(user.role, ["admin", "super_user"]), eq(user.status, "active")))
    .orderBy(asc(user.createdAt))
    .limit(1);
  return admin?.id ?? null;
}

/**
 * Rebuild every active stale session in `sessionIds` ("all" = every active
 * stale session) that holds no human work. Never throws per session — failures
 * are reported, and the session stays stale with its banner.
 */
export async function autoRebuildStaleSessions(
  sessionIds: string[] | "all",
  userId: string,
  opts: { dryRun?: boolean; limit?: number } = {}
): Promise<AutoRebuildReport> {
  const report: AutoRebuildReport = { rebuilt: [], kept: [], failed: [], deferred: 0 };
  if (sessionIds !== "all" && sessionIds.length === 0) return report;

  const sessions = await database
    .select({
      id: reconciliationSession.id,
      status: reconciliationSession.status,
      fileApprovedAt: reconciliationSession.fileApprovedAt,
      fileRejectionReason: reconciliationSession.fileRejectionReason,
    })
    .from(reconciliationSession)
    .where(
      and(
        isNull(reconciliationSession.archivedAt),
        isNotNull(reconciliationSession.staleAt),
        sessionIds === "all" ? undefined : inArray(reconciliationSession.id, sessionIds)
      )
    )
    .orderBy(asc(reconciliationSession.staleAt));
  if (sessions.length === 0) return report;

  const ids = sessions.map((s) => s.id);
  const [comparisons, queueCounts] = await Promise.all([
    database
      .select({
        sessionId: reconciliationComparison.sessionId,
        status: reconciliationComparison.status,
        reviewedBy: reconciliationComparison.reviewedBy,
        reviewedAt: reconciliationComparison.reviewedAt,
        reviewNotes: reconciliationComparison.reviewNotes,
        notes: reconciliationComparison.notes,
      })
      .from(reconciliationComparison)
      .where(inArray(reconciliationComparison.sessionId, ids)),
    database
      .select({ sessionId: reconciliationReviewQueue.sessionId, n: count() })
      .from(reconciliationReviewQueue)
      .where(inArray(reconciliationReviewQueue.sessionId, ids))
      .groupBy(reconciliationReviewQueue.sessionId),
  ]);
  const queueBySession = new Map(queueCounts.map((q) => [q.sessionId, q.n]));

  const safe: string[] = [];
  for (const s of sessions) {
    const reason = humanWorkReason({
      ...s,
      reviewQueueRows: queueBySession.get(s.id) ?? 0,
      comparisons: comparisons.filter((c) => c.sessionId === s.id),
    });
    if (reason) report.kept.push({ id: s.id, reason });
    else safe.push(s.id);
  }

  const batch = opts.limit === undefined ? safe : safe.slice(0, opts.limit);
  report.deferred = safe.length - batch.length;

  for (const id of batch) {
    if (opts.dryRun) {
      report.rebuilt.push({ from: id, to: "dry-run" });
      continue;
    }
    // ponytail: approvals made on the source DURING the ~3s rebuild land on the
    // archived run (visible — the page shows the archived banner). Guard the
    // archive with a re-check if that ever happens in practice.
    try {
      let current = id;
      for (let pass = 0; pass < MAX_PASSES; pass++) {
        const next = await rebuildReconciliationSession(current, userId);
        if (!next) throw new Error("rebuild returned null");
        current = next.id;
        if (!next.staleAt) break;
      }
      report.rebuilt.push({ from: id, to: current });
    } catch (error) {
      report.failed.push({ id, error: error instanceof Error ? error.message : String(error) });
    }
  }
  return report;
}

/**
 * Rebuild the safe ones among `sessionIds` after the response is sent. Outside
 * a request (scripts) there is nothing to schedule on — the nightly cron
 * sweeps them instead.
 */
export function scheduleAutoRebuild(sessionIds: string[], userId?: string): void {
  if (sessionIds.length === 0) return;
  try {
    after(async () => {
      try {
        const uid = userId ?? (await getAutomationUserId());
        if (!uid) {
          console.error("[auto-rebuild] no active admin user — left for the nightly cron", { sessionIds });
          return;
        }
        const report = await autoRebuildStaleSessions(sessionIds, uid);
        console.info("[auto-rebuild]", JSON.stringify(report));
      } catch (error) {
        console.error("[auto-rebuild] failed — left for the nightly cron:", error);
      }
    });
  } catch {
    // `after` was called outside a request scope — the nightly cron covers it.
  }
}
