import { NextRequest, NextResponse } from "next/server";

import { drizzleHashavshevetStore, RowNotLockedError, type HashavshevetStore } from "@/data-access/hashavshevet";
import { isAuthError, requireSuperUser } from "@/lib/api-middleware";
import { copy } from "@/lib/hashavshevet/copy";
import { fail, invalidBody, requestIdOf, serverFail } from "@/lib/hashavshevet/route-helpers";
import { unlockRowSchema } from "@/schemas/hashavshevet";

/** Spec §7 / §9: release one locked row so it can be sent again. Super user only; the reason is required. */

export interface UnlockRowDeps {
  store: Pick<HashavshevetStore, "unlockRow">;
}

export async function handleUnlockRow(
  request: NextRequest,
  rowId: string,
  deps: UnlockRowDeps = { store: drizzleHashavshevetStore },
): Promise<NextResponse> {
  const requestId = requestIdOf(request);
  const authResult = await requireSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const body: unknown = await request.json().catch(() => undefined);
  const parsed = unlockRowSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    await deps.store.unlockRow(rowId, parsed.data.reason, authResult.user.id);
    return NextResponse.json({ success: true, data: { id: rowId } });
  } catch (err) {
    if (err instanceof RowNotLockedError) return fail(copy.rowNotLocked, 409);
    return serverFail("hashavshevet_unlock_failed", requestId, err);
  }
}

// Keep the handler injectable: the route context is unpacked here and never reaches `deps`.
export async function POST(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  return handleUnlockRow(request, id);
}
