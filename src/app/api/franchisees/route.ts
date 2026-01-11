import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getFranchiseesWithContacts,
  getActiveFranchisees,
  getFranchiseesByBrand,
  getFranchiseesByStatus,
  createFranchisee,
  getFranchiseeStats,
  isFranchiseeCodeUnique,
} from "@/data-access/franchisees";
import { randomUUID } from "crypto";
import type { FranchiseeStatus, FranchiseeOwner } from "@/db/schema";

/**
 * GET /api/franchisees - Get all franchisees (Admin/Super User only)
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin or super_user
    const userRole = (session.user as typeof session.user & { role?: string })
      .role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const searchParams = request.nextUrl.searchParams;
    const filter = searchParams.get("filter"); // "all", "active", or a specific status
    const brandId = searchParams.get("brandId");

    let franchisees;

    if (brandId) {
      // Filter by brand
      franchisees = await getFranchiseesByBrand(brandId);
    } else if (filter === "active") {
      franchisees = await getActiveFranchisees();
    } else if (filter && ["pending", "inactive", "suspended", "terminated"].includes(filter)) {
      franchisees = await getFranchiseesByStatus(filter as FranchiseeStatus);
    } else {
      franchisees = await getFranchiseesWithContacts();
    }

    // Get stats if requested
    const includeStats = searchParams.get("stats") === "true";
    const stats = includeStats ? await getFranchiseeStats() : null;

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
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin or super_user
    const userRole = (session.user as typeof session.user & { role?: string })
      .role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const body = await request.json();
    const {
      brandId,
      name,
      code,
      aliases,
      companyId,
      address,
      city,
      state,
      postalCode,
      country,
      primaryContactName,
      primaryContactEmail,
      primaryContactPhone,
      owners,
      openingDate,
      leaseOption1End,
      leaseOption2End,
      leaseOption3End,
      franchiseAgreementEnd,
      status,
      notes,
      isActive,
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

    // Validate owners array if provided
    if (owners && Array.isArray(owners)) {
      for (const owner of owners) {
        if (!owner.name) {
          return NextResponse.json(
            { error: "Each owner must have a name" },
            { status: 400 }
          );
        }
        if (
          owner.ownershipPercentage !== undefined &&
          (owner.ownershipPercentage < 0 || owner.ownershipPercentage > 100)
        ) {
          return NextResponse.json(
            { error: "Ownership percentage must be between 0 and 100" },
            { status: 400 }
          );
        }
      }
    }

    const newFranchisee = await createFranchisee({
      id: randomUUID(),
      brandId,
      name,
      code,
      aliases: aliases || null,
      companyId: companyId || null,
      address: address || null,
      city: city || null,
      state: state || null,
      postalCode: postalCode || null,
      country: country || null,
      primaryContactName: primaryContactName || null,
      primaryContactEmail: primaryContactEmail || null,
      primaryContactPhone: primaryContactPhone || null,
      owners: owners || null,
      openingDate: openingDate || null,
      leaseOption1End: leaseOption1End || null,
      leaseOption2End: leaseOption2End || null,
      leaseOption3End: leaseOption3End || null,
      franchiseAgreementEnd: franchiseAgreementEnd || null,
      status: status || "pending",
      notes: notes || null,
      isActive: isActive !== undefined ? isActive : true,
      createdBy: session.user.id,
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
