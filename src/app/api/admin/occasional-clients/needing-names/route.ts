import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { listOccasionalClientsNeedingNames } from "@/data-access/occasional-clients";

export async function GET(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const { searchParams } = new URL(request.url);
  const franchiseeId = searchParams.get("franchiseeId");
  const periodMonth = Number(searchParams.get("periodMonth"));
  const periodYear = Number(searchParams.get("periodYear"));

  if (!franchiseeId || !Number.isInteger(periodMonth) || !Number.isInteger(periodYear)) {
    return NextResponse.json(
      { error: "Missing or invalid franchiseeId / periodMonth / periodYear" },
      { status: 400 }
    );
  }

  try {
    const items = await listOccasionalClientsNeedingNames({
      franchiseeId,
      periodMonth,
      periodYear,
    });
    return NextResponse.json({ data: { count: items.length, items } });
  } catch (error) {
    console.error("Failed to list occasional clients needing names:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת לקוחות מזדמנים" },
      { status: 500 }
    );
  }
}
