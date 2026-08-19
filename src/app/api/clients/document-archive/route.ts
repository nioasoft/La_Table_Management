/**
 * GET /api/clients/document-archive
 *
 * Flat archive of every inbound file — filed documents AND the ones we never
 * filed (blocked / rejected / unparsable) — each with a download link.
 *
 * Query params: clientId, franchiseeId, periodMonth, periodYear,
 *               kind=saved|blocked, search, months (lookback, default 12),
 *               limit (default 200, cap 1000).
 *
 * Auth: admin or super_user.
 */
import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { listDocumentArchive } from "@/data-access/document-archive";

function intParam(value: string | null, min: number, max: number): number | undefined {
  if (!value) return undefined;
  const parsed = parseInt(value, 10);
  if (!Number.isFinite(parsed)) return undefined;
  return Math.min(Math.max(parsed, min), max);
}

export async function GET(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const sp = request.nextUrl.searchParams;
  const kindParam = sp.get("kind");
  const kind = kindParam === "saved" || kindParam === "blocked" ? kindParam : undefined;

  const months = intParam(sp.get("months"), 1, 120) ?? 12;
  const since = new Date();
  since.setMonth(since.getMonth() - months);

  try {
    const rows = await listDocumentArchive({
      clientId: sp.get("clientId") || undefined,
      franchiseeId: sp.get("franchiseeId") || undefined,
      periodMonth: intParam(sp.get("periodMonth"), 1, 12),
      periodYear: intParam(sp.get("periodYear"), 2000, 2100),
      kind,
      search: sp.get("search") || undefined,
      since,
      limit: intParam(sp.get("limit"), 1, 1000) ?? 200,
    });

    return NextResponse.json({ rows });
  } catch (error) {
    console.error("Error listing document archive:", error);
    return NextResponse.json({ error: "שגיאה בטעינת ארכיון המסמכים" }, { status: 500 });
  }
}
