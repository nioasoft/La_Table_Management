/**
 * API routes for a specific BKMV year record.
 *
 * GET   /api/bkmvdata/years/[franchiseeId]/[year] → Get year data
 * PATCH /api/bkmvdata/years/[franchiseeId]/[year] → Lock/unlock year
 */

import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  requireSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getBkmvYearData,
  setYearComplete,
} from "@/data-access/franchisee-bkmv-year";

export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ franchiseeId: string; year: string }> }
) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const { franchiseeId, year: yearStr } = await params;
  const year = parseInt(yearStr, 10);
  if (isNaN(year)) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  }

  const data = await getBkmvYearData(franchiseeId, year);
  if (!data) {
    return NextResponse.json(
      { error: "No data found for this year" },
      { status: 404 }
    );
  }

  return NextResponse.json({ year: data });
}

export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ franchiseeId: string; year: string }> }
) {
  const authResult = await requireSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const { franchiseeId, year: yearStr } = await params;
  const year = parseInt(yearStr, 10);
  if (isNaN(year)) {
    return NextResponse.json({ error: "Invalid year" }, { status: 400 });
  }

  const body = await request.json();
  const { action } = body;

  if (action !== "lock" && action !== "unlock") {
    return NextResponse.json(
      { error: "action must be 'lock' or 'unlock'" },
      { status: 400 }
    );
  }

  const updated = await setYearComplete(
    franchiseeId,
    year,
    action === "lock"
  );

  if (!updated) {
    return NextResponse.json(
      { error: "Year record not found" },
      { status: 404 }
    );
  }

  return NextResponse.json({
    success: true,
    year: {
      id: updated.id,
      year: updated.year,
      isComplete: updated.isComplete,
      monthCount: updated.monthCount,
    },
  });
}
