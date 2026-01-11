import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  matchSingleFranchiseeName,
  matchMultipleFranchiseeNames,
  addFranchiseeAlias,
} from "@/data-access/franchisees";
import type { MatcherConfig } from "@/lib/franchisee-matcher";

/**
 * POST /api/franchisees/match - Match franchisee names from supplier files
 *
 * Request body:
 * {
 *   names: string[] | string;  // Single name or array of names to match
 *   config?: {
 *     minConfidence?: number;    // Minimum confidence (0-1, default: 0.7)
 *     reviewThreshold?: number;  // Below this, flag for review (default: 0.85)
 *     maxAlternatives?: number;  // Max alternative suggestions (default: 3)
 *     includeInactive?: boolean; // Include inactive franchisees (default: false)
 *     brandId?: string;          // Filter by brand ID
 *   }
 * }
 *
 * Response:
 * For single name:
 * {
 *   result: FranchiseeMatchResult
 * }
 *
 * For multiple names:
 * {
 *   results: FranchiseeMatchResult[];
 *   summary: {
 *     total: number;
 *     matched: number;
 *     needsReview: number;
 *     unmatched: number;
 *     averageConfidence: number;
 *   }
 * }
 */
export async function POST(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user has appropriate role
    const userRole = (session.user as typeof session.user & { role?: string })
      .role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { names, config } = body as {
      names: string | string[];
      config?: Partial<MatcherConfig>;
    };

    // Validate input
    if (!names || (Array.isArray(names) && names.length === 0)) {
      return NextResponse.json(
        { error: "Names are required" },
        { status: 400 }
      );
    }

    // Handle single name
    if (typeof names === "string") {
      const result = await matchSingleFranchiseeName(names, config);
      return NextResponse.json({ result });
    }

    // Handle multiple names
    if (!Array.isArray(names)) {
      return NextResponse.json(
        { error: "Names must be a string or array of strings" },
        { status: 400 }
      );
    }

    // Filter out empty names
    const validNames = names.filter(n => typeof n === "string" && n.trim());

    if (validNames.length === 0) {
      return NextResponse.json(
        { error: "No valid names provided" },
        { status: 400 }
      );
    }

    const batchResult = await matchMultipleFranchiseeNames(validNames, config);

    return NextResponse.json({
      results: batchResult.results,
      summary: batchResult.summary,
    });
  } catch (error) {
    console.error("Error matching franchisee names:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PUT /api/franchisees/match - Add an alias to a franchisee based on match result
 *
 * Use this endpoint to confirm a fuzzy match by adding the original name as an alias.
 *
 * Request body:
 * {
 *   franchiseeId: string;  // The franchisee to add alias to
 *   alias: string;         // The alias to add (usually the original name from file)
 * }
 *
 * Response:
 * {
 *   success: boolean;
 *   franchisee: Franchisee;
 * }
 */
export async function PUT(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user has appropriate role
    const userRole = (session.user as typeof session.user & { role?: string })
      .role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const { franchiseeId, alias } = body as {
      franchiseeId: string;
      alias: string;
    };

    // Validate input
    if (!franchiseeId || !alias) {
      return NextResponse.json(
        { error: "Franchisee ID and alias are required" },
        { status: 400 }
      );
    }

    // Add the alias
    const updated = await addFranchiseeAlias(franchiseeId, alias.trim());

    if (!updated) {
      return NextResponse.json(
        { error: "Franchisee not found" },
        { status: 404 }
      );
    }

    return NextResponse.json({
      success: true,
      franchisee: updated,
    });
  } catch (error) {
    console.error("Error adding franchisee alias:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
