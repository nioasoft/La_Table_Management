import { NextRequest, NextResponse } from "next/server";

import { drizzleHashavshevetStore, type HashavshevetStore } from "@/data-access/hashavshevet";
import { isAuthError, requireSuperUser } from "@/lib/api-middleware";
import { copy } from "@/lib/hashavshevet/copy";
import { fail, invalidBody, requestIdOf, serverFail } from "@/lib/hashavshevet/route-helpers";
import { companyPatchSchema } from "@/schemas/hashavshevet";

/** Spec §7 / §9: activate a company (liveFrom; null deactivates) and toggle "requires approval". Super user only. */

export interface PatchCompanyDeps {
  store: Pick<HashavshevetStore, "updateCompany">;
}

export async function handlePatchCompany(
  request: NextRequest,
  id: string,
  deps: PatchCompanyDeps = { store: drizzleHashavshevetStore },
): Promise<NextResponse> {
  const requestId = requestIdOf(request);
  const authResult = await requireSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const body: unknown = await request.json().catch(() => undefined);
  const parsed = companyPatchSchema.safeParse(body);
  if (!parsed.success) return invalidBody(parsed.error);

  try {
    // liveFrom is a YYYY-MM-DD string end to end; it is never turned into a Date here.
    const company = await deps.store.updateCompany(id, parsed.data, authResult.user.id);
    if (!company) return fail(copy.companyNotFound, 404);
    return NextResponse.json({ success: true, data: { company } });
  } catch (err) {
    return serverFail("hashavshevet_company_update_failed", requestId, err);
  }
}

// Keep the handler injectable: the route context is unpacked here and never reaches `deps`.
export async function PATCH(request: NextRequest, { params }: { params: Promise<{ id: string }> }): Promise<NextResponse> {
  const { id } = await params;
  return handlePatchCompany(request, id);
}
