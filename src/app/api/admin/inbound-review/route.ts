/**
 * GET /api/admin/inbound-review
 *
 * Lists rows from `inbound_review_queue` for the admin UI. Read-only in
 * Phase 2a; Phase 2b will add POST/PATCH for confirm/reject actions.
 *
 * Query params:
 *   ?status=auto_committed|failed|needs_review   (default: all)
 *   ?clientCode=WOLT|HAAT|MISHLOCHA|...           (default: all)
 *   ?days=7                                       (default: 7, max 90)
 *   ?limit=100                                    (default: 100, max 500)
 *
 * Auth: admin or super_user.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import {
  listInboundReviewEntries,
  getInboundReviewStatusCounts,
} from "@/data-access/inbound-review-queue";
import type { InboundReviewStatus } from "@/db/schema";

const VALID_STATUSES: ReadonlyArray<InboundReviewStatus> = [
  "auto_committed",
  "failed",
  "needs_review",
];

export async function GET(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const sp = request.nextUrl.searchParams;
  const statusParam = sp.get("status");
  const status =
    statusParam && (VALID_STATUSES as readonly string[]).includes(statusParam)
      ? (statusParam as InboundReviewStatus)
      : undefined;
  const clientCode = sp.get("clientCode") ?? undefined;

  const daysRaw = parseInt(sp.get("days") ?? "7", 10);
  const days = Number.isFinite(daysRaw) ? Math.min(Math.max(daysRaw, 1), 90) : 7;
  const since = new Date(Date.now() - days * 24 * 60 * 60 * 1000);

  const limitRaw = parseInt(sp.get("limit") ?? "100", 10);
  const limit = Number.isFinite(limitRaw)
    ? Math.min(Math.max(limitRaw, 1), 500)
    : 100;

  const [entries, statusCounts] = await Promise.all([
    listInboundReviewEntries({ status, clientCode, since, limit }),
    getInboundReviewStatusCounts(since),
  ]);

  return NextResponse.json({
    entries,
    statusCounts,
    range: { since: since.toISOString(), days },
  });
}
