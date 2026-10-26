import { NextRequest, NextResponse } from "next/server";

import { drizzleHashavshevetStore, type HashavshevetStore, type SendSummary } from "@/data-access/hashavshevet";
import { isAuthError, requireAdminOrSuperUser } from "@/lib/api-middleware";
import { invalidBody, requestIdOf, serverFail } from "@/lib/hashavshevet/route-helpers";
import { STALE_PENDING_MINUTES } from "@/lib/hashavshevet/types";
import { sendsListQuerySchema } from "@/schemas/hashavshevet";

/** Spec §9: the sends screen. `?count=awaiting` returns just the number, for the sidebar badge. */

export interface ListSendsDeps {
  store: Pick<HashavshevetStore, "listSends" | "countAwaitingApproval">;
  /** Epoch ms; injectable so tests can pin the clock. */
  now: () => number;
}

/** A send as the list returns it. `stalePending`: Reut may now mark it "arrived" / "not arrived". */
export type SendListItem = SendSummary & { stalePending: boolean };

const DEFAULT_DEPS: ListSendsDeps = { store: drizzleHashavshevetStore, now: () => Date.now() };

function withStalePending(send: SendSummary, now: number): SendListItem {
  const ageMs = now - send.sentAt.getTime();
  return { ...send, stalePending: send.status === "pending" && ageMs > STALE_PENDING_MINUTES * 60_000 };
}

export async function handleListSends(request: NextRequest, deps: ListSendsDeps = DEFAULT_DEPS): Promise<NextResponse> {
  const requestId = requestIdOf(request);
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const query = Object.fromEntries(request.nextUrl.searchParams);
  if (query.count === "awaiting") {
    try {
      return NextResponse.json({ success: true, data: { count: await deps.store.countAwaitingApproval() } });
    } catch (err) {
      return serverFail("hashavshevet_awaiting_count_failed", requestId, err);
    }
  }

  const parsed = sendsListQuerySchema.safeParse(query);
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    const now = deps.now();
    const sends = (await deps.store.listSends(parsed.data)).map((s) => withStalePending(s, now));
    return NextResponse.json({ success: true, data: { sends } });
  } catch (err) {
    return serverFail("hashavshevet_sends_list_failed", requestId, err);
  }
}

// A named wrapper, never `export const GET = handleListSends`: Next passes a route context as the
// second argument, which would land in `deps`.
export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleListSends(request);
}
