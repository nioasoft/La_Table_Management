import { NextRequest, NextResponse } from "next/server";
import type { z } from "zod";

import { drizzleHashavshevetStore, LockConflictError, type HashavshevetStore } from "@/data-access/hashavshevet";
import { isAuthError, requireAdminOrSuperUser } from "@/lib/api-middleware";
import { blockingStatuses, rowsToSend } from "@/lib/hashavshevet/classify";
import { copy } from "@/lib/hashavshevet/copy";
import { EXPORTS, type ExportDefinition } from "@/lib/hashavshevet/registry";
import { buildAndClassify, fail, requestIdOf } from "@/lib/hashavshevet/route-helpers";
import {
  matchesExpected,
  planCompanySends,
  sendCompany,
  type CompanySendResult,
  type SendFn,
} from "@/lib/hashavshevet/send-flow";
import type { ExportType } from "@/lib/hashavshevet/types";
import { sendToHashavshevet } from "@/lib/hconnect";
import { checkRateLimit, createRateLimitHeaders, RateLimitConfigs } from "@/lib/rate-limit";
import { sendRequestSchema } from "@/schemas/hashavshevet";

/** Spec §7: rebuild, compare to what the user saw, lock per company, send in chunks, record outcomes. */

export const maxDuration = 300;
/** No H-Connect request starts unless its full timeout still fits this budget (ruling R16). */
const SEND_BUDGET_MS = (maxDuration - 30) * 1000;

export interface SendDeps {
  store: Pick<HashavshevetStore, "getCompanies" | "getActiveLocks" | "createSendWithLocks" | "finishSend">;
  exports: Record<ExportType, ExportDefinition>;
  send: SendFn;
  /** Epoch ms; injectable so tests can drive the time budget. */
  now: () => number;
}

export interface SendData {
  sends: CompanySendResult[];
}

type SendRequest = z.infer<typeof sendRequestSchema> & { sentBy: string; requestId: string; deadline: number };

const DEFAULT_DEPS: SendDeps = {
  store: drizzleHashavshevetStore,
  exports: EXPORTS,
  send: sendToHashavshevet,
  now: () => Date.now(),
};

async function sendExport(deps: SendDeps, req: SendRequest): Promise<NextResponse> {
  const definition = deps.exports[req.exportType];
  const { blockingErrors, companies, classified } = await buildAndClassify(deps.store, definition, req.params);
  const newRows = rowsToSend(classified);
  if (!matchesExpected(newRows, req.expected)) return fail(copy.dataChanged, 409);

  const blocking = blockingStatuses(classified);
  if (blockingErrors.length > 0 || blocking.length > 0) {
    return fail(copy.sendBlocked, 422, { data: { blockingErrors, blockingStatuses: blocking } });
  }

  const plans = planCompanySends(newRows, companies, definition.plugin);
  const ctx = { ...req, store: deps.store, send: deps.send, now: deps.now, plugin: definition.plugin, onApproved: definition.onApproved };
  const sends: CompanySendResult[] = [];
  for (const plan of plans) {
    try {
      sends.push(await sendCompany(ctx, plan));
    } catch (err) {
      if (!(err instanceof LockConflictError)) throw err;
      // Someone else is sending these rows; this company sent nothing. Earlier companies did.
      return fail(copy.sendConflict, 409, { data: { sends } satisfies SendData });
    }
  }
  return NextResponse.json({ success: true, data: { sends } satisfies SendData });
}

export async function handleSend(request: NextRequest, deps: SendDeps = DEFAULT_DEPS): Promise<NextResponse> {
  const startedAt = deps.now();
  const requestId = requestIdOf(request);
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  // Ruling R15: month start means 20+ sends; row locks, not this limit, prevent duplicates.
  const limit = checkRateLimit(`hashavshevet-send:${authResult.user.id}`, RateLimitConfigs.api);
  if (!limit.success) {
    return NextResponse.json(
      { success: false, error: copy.rateLimited },
      { status: 429, headers: createRateLimitHeaders(limit) },
    );
  }

  const body: unknown = await request.json().catch(() => undefined);
  const parsed = sendRequestSchema.safeParse(body);
  if (!parsed.success) return fail(copy.invalidRequest, 400);

  try {
    const deadline = startedAt + SEND_BUDGET_MS;
    return await sendExport(deps, { ...parsed.data, sentBy: authResult.user.id, requestId, deadline });
  } catch (err) {
    console.error(
      JSON.stringify({
        event: "hashavshevet_send_failed",
        requestId,
        exportType: parsed.data.exportType,
        error: err instanceof Error ? err.message : String(err),
      }),
    );
    return fail(copy.serverError(requestId), 500, { requestId });
  }
}

// A named wrapper, never `export const POST = handleSend`: Next passes a route context as the
// second argument, which would land in `deps`.
export async function POST(request: NextRequest): Promise<NextResponse> {
  return handleSend(request);
}
