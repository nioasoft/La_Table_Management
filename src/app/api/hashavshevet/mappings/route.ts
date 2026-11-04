import { NextRequest, NextResponse } from "next/server";

import { drizzleHashavshevetStore, type HashavshevetStore } from "@/data-access/hashavshevet";
import { isAuthError, requireAdminOrSuperUser, requireSuperUser } from "@/lib/api-middleware";
import { copy } from "@/lib/hashavshevet/copy";
import { fail, invalidBody, requestIdOf, serverFail } from "@/lib/hashavshevet/route-helpers";
import { mappingPatchSchema } from "@/schemas/hashavshevet";

/** Spec §7 / §9: which Hashavshevet company each brand and franchisee sends to. Reading: admin; editing: super user. */

export interface MappingsDeps {
  store: Pick<HashavshevetStore, "listMappings" | "setMapping">;
}

const DEFAULT_DEPS: MappingsDeps = { store: drizzleHashavshevetStore };

export async function handleGetMappings(request: NextRequest, deps: MappingsDeps = DEFAULT_DEPS): Promise<NextResponse> {
  const requestId = requestIdOf(request);
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  try {
    return NextResponse.json({ success: true, data: await deps.store.listMappings() });
  } catch (err) {
    return serverFail("hashavshevet_mappings_list_failed", requestId, err);
  }
}

export async function handlePatchMapping(request: NextRequest, deps: MappingsDeps = DEFAULT_DEPS): Promise<NextResponse> {
  const requestId = requestIdOf(request);
  const authResult = await requireSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const body: unknown = await request.json().catch(() => undefined);
  const parsed = mappingPatchSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);
  const { kind, id, companyId } = parsed.data;

  try {
    if (!(await deps.store.setMapping(kind, id, companyId))) return fail(copy.mappingTargetNotFound, 404);
    return NextResponse.json({ success: true, data: { kind, id, companyId } });
  } catch (err) {
    return serverFail("hashavshevet_mapping_update_failed", requestId, err);
  }
}

// Named wrappers, never `export const GET = handleGetMappings`: Next passes a route context as the
// second argument, which would land in `deps`.
export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleGetMappings(request);
}

export async function PATCH(request: NextRequest): Promise<NextResponse> {
  return handlePatchMapping(request);
}
