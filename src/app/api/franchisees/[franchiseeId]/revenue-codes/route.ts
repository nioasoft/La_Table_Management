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
  removeFranchiseeRevenueCode,
  type RevenueCodeInfo,
} from "@/data-access/franchisee-revenue-codes";

interface RouteContext {
  params: Promise<{ franchiseeId: string }>;
}

/**
 * GET /api/franchisees/[franchiseeId]/revenue-codes
 * Get saved revenue codes for a franchisee
 * Query params:
 *   details=true - return full records with accountName
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAuth(request);
    if (isAuthError(authResult)) return authResult;

    const { franchiseeId } = await context.params;
    const { searchParams } = new URL(request.url);
    const wantDetails = searchParams.get("details") === "true";

    if (wantDetails) {
      const records = await getFranchiseeRevenueCodes(franchiseeId);
      const details = records.map((r) => ({
        accountCode: r.accountCode,
        accountName: r.accountName,
      }));
      return NextResponse.json({ details });
    }

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

/**
 * DELETE /api/franchisees/[franchiseeId]/revenue-codes
 * Remove a specific revenue code from a franchisee
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { franchiseeId } = await context.params;

    const body = await request.json();
    const { accountCode } = body as { accountCode: string };

    if (!accountCode || typeof accountCode !== "string") {
      return NextResponse.json(
        { error: "accountCode is required" },
        { status: 400 }
      );
    }

    const removed = await removeFranchiseeRevenueCode(
      franchiseeId,
      accountCode
    );

    return NextResponse.json({ success: true, removed });
  } catch (error) {
    console.error("Error removing franchisee revenue code:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
