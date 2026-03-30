/**
 * Commission Invoice Verification API
 *
 * GET /api/clients/commission-invoices
 *   ?periodMonth=X&periodYear=Y           → summary per client
 *   ?periodMonth=X&periodYear=Y&clientId=Z → per-franchisee verification rows
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import {
  getInvoiceVerification,
  getInvoiceVerificationSummary,
} from "@/data-access/commission-invoices";

export async function GET(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const { searchParams } = new URL(request.url);
  const periodMonth = parseInt(searchParams.get("periodMonth") ?? "");
  const periodYear = parseInt(searchParams.get("periodYear") ?? "");
  const clientId = searchParams.get("clientId");

  if (isNaN(periodMonth) || isNaN(periodYear)) {
    return NextResponse.json(
      { error: "נדרשים פרמטרים periodMonth ו-periodYear" },
      { status: 400 }
    );
  }

  try {
    if (clientId) {
      // Per-franchisee verification for a specific client
      const rows = await getInvoiceVerification(
        clientId,
        periodMonth,
        periodYear
      );
      return NextResponse.json({ rows });
    }

    // Summary across all clients
    const summary = await getInvoiceVerificationSummary(
      periodMonth,
      periodYear
    );
    return NextResponse.json({ summary });
  } catch (error) {
    console.error("Error fetching commission invoice verification:", error);
    return NextResponse.json(
      { error: "שגיאה בטעינת נתוני אימות חשבוניות" },
      { status: 500 }
    );
  }
}
