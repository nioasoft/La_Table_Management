import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  requireAuth,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getClassifications,
  getClassificationMap,
  setClassification,
  bulkSetClassifications,
  removeClassification,
  type ClassificationEntry,
} from "@/data-access/franchisee-account-classifications";
import type { AccountCategory } from "@/db/schema";

interface RouteContext {
  params: Promise<{ franchiseeId: string }>;
}

const VALID_CATEGORIES: AccountCategory[] = [
  "supplier",
  "revenue",
  "employee",
  "expense",
  "uncategorized",
];

/**
 * GET /api/franchisees/[franchiseeId]/account-classifications
 * Get saved account classifications for a franchisee
 * Query params:
 *   format=map - return as { map: Record<accountKey, category> }
 *   (default) - return as { classifications: FranchiseeAccountClassification[] }
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAuth(request);
    if (isAuthError(authResult)) return authResult;

    const { franchiseeId } = await context.params;
    const { searchParams } = new URL(request.url);
    const format = searchParams.get("format");

    if (format === "map") {
      const map = await getClassificationMap(franchiseeId);
      const obj: Record<string, string> = {};
      for (const [key, val] of map) {
        obj[key] = val;
      }
      return NextResponse.json({ map: obj });
    }

    const classifications = await getClassifications(franchiseeId);
    return NextResponse.json({ classifications });
  } catch (error) {
    console.error("Error fetching account classifications:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/franchisees/[franchiseeId]/account-classifications
 * Upsert classification(s)
 * Body:
 *   Single: { accountKey: string, category: AccountCategory, accountName?: string }
 *   Bulk:   { items: ClassificationEntry[] }
 */
export async function PUT(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { user } = authResult;
    const { franchiseeId } = await context.params;

    const body = await request.json();

    // Bulk mode
    if (Array.isArray(body.items)) {
      const items = body.items as ClassificationEntry[];

      // Validate all items
      for (const item of items) {
        if (!item.accountKey || !VALID_CATEGORIES.includes(item.category)) {
          return NextResponse.json(
            { error: "Invalid accountKey or category in items" },
            { status: 400 }
          );
        }
      }

      const result = await bulkSetClassifications(
        franchiseeId,
        items,
        user.id
      );
      return NextResponse.json({ success: true, ...result });
    }

    // Single mode
    const { accountKey, category, accountName } = body as {
      accountKey: string;
      category: AccountCategory;
      accountName?: string;
    };

    if (!accountKey || typeof accountKey !== "string") {
      return NextResponse.json(
        { error: "accountKey is required" },
        { status: 400 }
      );
    }

    if (!VALID_CATEGORIES.includes(category)) {
      return NextResponse.json(
        { error: `Invalid category. Must be one of: ${VALID_CATEGORIES.join(", ")}` },
        { status: 400 }
      );
    }

    await setClassification(
      franchiseeId,
      accountKey,
      category,
      accountName,
      user.id
    );

    return NextResponse.json({ success: true });
  } catch (error) {
    console.error("Error setting account classification:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * DELETE /api/franchisees/[franchiseeId]/account-classifications
 * Remove a classification (revert to auto-detection)
 * Body: { accountKey: string }
 */
export async function DELETE(request: NextRequest, context: RouteContext) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { franchiseeId } = await context.params;

    const body = await request.json();
    const { accountKey } = body as { accountKey: string };

    if (!accountKey || typeof accountKey !== "string") {
      return NextResponse.json(
        { error: "accountKey is required" },
        { status: 400 }
      );
    }

    const removed = await removeClassification(franchiseeId, accountKey);
    return NextResponse.json({ success: true, removed });
  } catch (error) {
    console.error("Error removing account classification:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
