/**
 * API routes for BKMV year data.
 *
 * GET /api/bkmvdata/years?franchiseeId=X          → List all years for a franchisee
 * GET /api/bkmvdata/years?franchiseeId=X&year=Y   → Get full year data
 */

import { NextRequest, NextResponse } from "next/server";
import { requireAdminOrSuperUser, isAuthError } from "@/lib/api-middleware";
import {
  getBkmvYearsForFranchisee,
  getBkmvYearData,
} from "@/data-access/franchisee-bkmv-year";

export async function GET(request: NextRequest) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const franchiseeId = request.nextUrl.searchParams.get("franchiseeId");
  if (!franchiseeId) {
    return NextResponse.json(
      { error: "franchiseeId is required" },
      { status: 400 }
    );
  }

  const yearParam = request.nextUrl.searchParams.get("year");

  if (yearParam) {
    const year = parseInt(yearParam, 10);
    if (isNaN(year)) {
      return NextResponse.json(
        { error: "Invalid year" },
        { status: 400 }
      );
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

  // List all years
  const years = await getBkmvYearsForFranchisee(franchiseeId);
  return NextResponse.json({
    years: years.map((y) => ({
      id: y.id,
      year: y.year,
      monthCount: y.monthCount,
      monthsCovered: y.monthsCovered,
      isComplete: y.isComplete,
      updatedAt: y.updatedAt,
    })),
  });
}
