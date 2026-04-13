import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import { listOccasionalClients } from "@/data-access/occasional-clients";

export async function GET(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const { searchParams } = new URL(request.url);
  const includeIgnored = searchParams.get("includeIgnored") === "true";

  try {
    const rows = await listOccasionalClients({ includeIgnored });
    return NextResponse.json({ data: rows });
  } catch (error) {
    console.error("Failed to list occasional clients:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת לקוחות מזדמנים" },
      { status: 500 }
    );
  }
}
