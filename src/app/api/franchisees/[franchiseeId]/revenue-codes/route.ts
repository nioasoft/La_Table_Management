import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  requireAuth,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getFranchiseeRevenueCodesList,
  getFranchiseeRevenueCodes,
  setFranchiseeRevenueCodes,
  type RevenueCodeInfo,
} from "@/data-access/franchisee-revenue-codes";

interface RouteContext {
  params: Promise<{ franchiseeId: string }>;
}

/**
 * GET /api/franchisees/[franchiseeId]/revenue-codes
 * Get saved revenue codes for a franchisee
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAuth(request);
    if (isAuthError(authResult)) return authResult;

    const { franchiseeId } = await context.params;

    const codes = await getFranchiseeRevenueCodesList(franchiseeId);

    return NextResponse.json({ codes });
  } catch (error) {
    console.error("Error fetching franchisee revenue codes:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/franchisees/[franchiseeId]/revenue-codes
 * Set revenue codes for a franchisee (replaces all existing)
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { user } = authResult;
    const { franchiseeId } = await context.params;

    const body = await request.json();
    const { codes } = body as { codes: RevenueCodeInfo[] };

    if (!Array.isArray(codes)) {
      return NextResponse.json(
        { error: "codes must be an array" },
        { status: 400 }
      );
    }

    const result = await setFranchiseeRevenueCodes(
      franchiseeId,
      codes,
      user.id
    );

    return NextResponse.json({
      success: true,
      added: result.added,
      removed: result.removed,
    });
  } catch (error) {
    console.error("Error setting franchisee revenue codes:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
