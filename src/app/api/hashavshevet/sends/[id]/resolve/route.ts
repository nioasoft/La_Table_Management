import { NextRequest, NextResponse } from "next/server";

import { drizzleHashavshevetStore, InvalidTransitionError, type HashavshevetStore } from "@/data-access/hashavshevet";
import { isAuthError, requireAdminOrSuperUser } from "@/lib/api-middleware";
import { copy } from "@/lib/hashavshevet/copy";
import { fail, invalidBody, requestIdOf, serverFail } from "@/lib/hashavshevet/route-helpers";
import { resolveSendSchema } from "@/schemas/hashavshevet";

/**
 * Spec §7: Reut's approve / reject / "arrived" on a whole send. Open to admins (her daily action),
 * unlike unlocking a single row. The store owns which transitions are legal.
 */

export interface ResolveSendDeps {
  store: Pick<HashavshevetStore, "resolveSend">;
}

export async function handleResolveSend(
  request: NextRequest,
  sendId: string,
  deps: ResolveSendDeps = { store: drizzleHashavshevetStore },
): Promise<NextResponse> {
  const requestId = requestIdOf(request);
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const body: unknown = await request.json().catch(() => undefined);
  const parsed = resolveSendSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const { outcome, note } = parsed.data;

  try {
    await deps.store.resolveSend(sendId, outcome, note || null, authResult.user.id);
    return NextResponse.json({ success: true, data: { id: sendId, outcome } });
  } catch (err) {
    if (err instanceof InvalidTransitionError) {
      return err.currentStatus === null
        ? fail(copy.sendNotFound, 404)
        : fail(copy.invalidTransition(err.outcome, err.currentStatus), 409);
    }
    return serverFail("hashavshevet_resolve_failed", requestId, err);
  }
}

// Keep the handler injectable: the route context is unpacked here and never reaches `deps`.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  return handleResolveSend(request, id);
}
