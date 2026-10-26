import { NextRequest, NextResponse } from "next/server";

import { drizzleHashavshevetStore, type HashavshevetStore } from "@/data-access/hashavshevet";
import { isAuthError, requireAdminOrSuperUser } from "@/lib/api-middleware";
import { requestIdOf, serverFail } from "@/lib/hashavshevet/route-helpers";

/** Spec §7 / §9: the companies table of the settings screen. Reading is open to admins; editing is super-user only. */

export interface ListCompaniesDeps {
  store: Pick<HashavshevetStore, "listCompanies">;
}

export async function handleListCompanies(
  request: NextRequest,
  deps: ListCompaniesDeps = { store: drizzleHashavshevetStore },
): Promise<NextResponse> {
  const requestId = requestIdOf(request);
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  try {
    return NextResponse.json({ success: true, data: { companies: await deps.store.listCompanies() } });
  } catch (err) {
    return serverFail("hashavshevet_companies_list_failed", requestId, err);
  }
}

// A named wrapper, never `export const GET = handleListCompanies`: Next passes a route context as the
// second argument, which would land in `deps`.
export async function GET(request: NextRequest): Promise<NextResponse> {
  return handleListCompanies(request);
}
