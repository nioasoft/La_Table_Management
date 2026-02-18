import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getFranchiseesWithContacts,
  getFranchiseeByCompanyId,
  createFranchisee,
  getFranchiseeStats,
  isFranchiseeCodeUnique,
  getFranchiseesPageData,
  getOtherIncomeSources,
  type GetFranchiseesOptions,
} from "@/data-access/franchisees";
import { randomUUID } from "crypto";
import type { FranchiseeStatus, FranchiseeCategory } from "@/db/schema";

/**
 * GET /api/franchisees - Get all franchisees (Admin/Super User only)
 *
 * Query params:
 * - combined=true: Returns all page data in one call (optimized)
 * - filter: "all", "active", or a specific status
 * - brandId: Filter by brand
 * - companyId: Search by company ID (for BKMVDATA matching)
 * - stats=true: Include stats in response
 * - category: "regular" (default), "other", or "all" - filter by franchisee category
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;

    // Optimized: Return all page data in one call
    const combined = searchParams.get("combined") === "true";
    if (combined) {
      const pageData = await getFranchiseesPageData();
      return NextResponse.json(pageData);
    }

    const filter = searchParams.get("filter"); // "all", "active", or a specific status
    const brandId = searchParams.get("brandId");
    const companyId = searchParams.get("companyId"); // ח.פ - for BKMVDATA matching
    const categoryParam = searchParams.get("category"); // "regular", "other", or "all"

    // Determine category filter
    const category: GetFranchiseesOptions["category"] =
      categoryParam === "all" ? "all" :
      categoryParam === "other" ? "other" :
      "regular"; // default to regular

    let franchisees;

    // If companyId is provided, return single franchisee match
    if (companyId) {
      const franchisee = await getFranchiseeByCompanyId(companyId);
      return NextResponse.json({
        franchisee,
        found: !!franchisee
      });
    }

    // Shortcut for "other" income sources
    if (category === "other" && !brandId && !filter) {
      franchisees = await getOtherIncomeSources();
      const stats = searchParams.get("stats") === "true" ? await getFranchiseeStats({ category: "other" }) : null;
      return NextResponse.json({ franchisees, stats });
    }

    if (brandId) {
      franchisees = await getFranchiseesWithContacts({ category, brandId });
    } else if (filter === "active") {
      franchisees = await getFranchiseesWithContacts({ category, isActive: true });
    } else if (filter && ["pending", "inactive", "suspended", "terminated"].includes(filter)) {
      franchisees = await getFranchiseesWithContacts({ category, status: filter as FranchiseeStatus });
    } else {
      franchisees = await getFranchiseesWithContacts({ category });
    }

    // Get stats if requested
    const includeStats = searchParams.get("stats") === "true";
    const stats = includeStats ? await getFranchiseeStats({ category }) : null;

    return NextResponse.json({ franchisees, stats });
  } catch (error) {
    console.error("Error fetching franchisees:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/franchisees - Create a new franchisee (Admin/Super User only)
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const {
      brandId,
      name,
      code,
      aliases,
      address,
      city,
      state,
      postalCode,
      country,
      openingDate,
      leaseOption1End,
      leaseOption2End,
      leaseOption3End,
      franchiseAgreementEnd,
      status,
      notes,
      isActive,
      isKosher,
      category,
    } = body;

    // Validate required fields
    if (!brandId || !name || !code) {
      return NextResponse.json(
        { error: "Brand, name, and code are required" },
        { status: 400 }
      );
    }

    // Check if code is unique
    const isUnique = await isFranchiseeCodeUnique(code);
    if (!isUnique) {
      return NextResponse.json(
        { error: "Franchisee code already exists" },
        { status: 400 }
      );
    }

    const newFranchisee = await createFranchisee({
      id: randomUUID(),
      brandId,
      name,
      code,
      aliases: aliases || null,
      companyId: /^\d+$/.test(code) ? code : null,
      address: address || null,
      city: city || null,
      state: state || null,
      postalCode: postalCode || null,
      country: country || null,
      openingDate: openingDate || null,
      leaseOption1End: leaseOption1End || null,
      leaseOption2End: leaseOption2End || null,
      leaseOption3End: leaseOption3End || null,
      franchiseAgreementEnd: franchiseAgreementEnd || null,
      status: status || "pending",
      notes: notes || null,
      isActive: isActive !== undefined ? isActive : true,
      isKosher: isKosher !== undefined ? isKosher : true,
      category: category || "regular",
      createdBy: user.id,
    });

    return NextResponse.json({ franchisee: newFranchisee }, { status: 201 });
  } catch (error) {
    console.error("Error creating franchisee:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
