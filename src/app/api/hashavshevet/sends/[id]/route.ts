import { NextRequest, NextResponse } from "next/server";

import { drizzleHashavshevetStore, type HashavshevetStore } from "@/data-access/hashavshevet";
import { isAuthError, requireAdminOrSuperUser } from "@/lib/api-middleware";
import { copy } from "@/lib/hashavshevet/copy";
import { fail, requestIdOf, serverFail } from "@/lib/hashavshevet/route-helpers";

/** Spec §9: one send with its raw H-Connect response and every row it locked (the detail view). */

export interface GetSendDeps {
  store: Pick<HashavshevetStore, "getSendDetail">;
}

export async function handleGetSend(
  request: NextRequest,
  sendId: string,
  deps: GetSendDeps = { store: drizzleHashavshevetStore },
): Promise<NextResponse> {
  const requestId = requestIdOf(request);
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  try {
    const send = await deps.store.getSendDetail(sendId);
    if (!send) return fail(copy.sendNotFound, 404);
    return NextResponse.json({ success: true, data: { send } });
  } catch (err) {
    return serverFail("hashavshevet_send_detail_failed", requestId, err);
  }
}

// Keep the handler injectable: the route context is unpacked here and never reaches `deps`.
export async function GET(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  return handleGetSend(request, id);
}
