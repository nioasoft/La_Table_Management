import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getBrands, getActiveBrands, createBrand, getBrandStats, isBrandCodeUnique } from "@/data-access/brands";
import { randomUUID } from "crypto";

/**
 * GET /api/brands - Get all brands (Admin/Super User only)
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;
    const filter = searchParams.get("filter");

    let brands;
    if (filter === "active") {
      brands = await getActiveBrands();
    } else {
      brands = await getBrands();
    }

    // Get stats if requested
    const includeStats = searchParams.get("stats") === "true";
    const stats = includeStats ? await getBrandStats() : null;

    return NextResponse.json({ brands, stats });
  } catch (error) {
    console.error("Error fetching brands:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/brands - Create a new brand (Admin/Super User only)
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const { code, nameHe, nameEn, description, logoUrl, website, contactEmail, contactPhone, address, isActive } = body;

    // Validate required fields
    if (!code || !nameHe) {
      return NextResponse.json(
        { error: "Code and Hebrew name are required" },
        { status: 400 }
      );
    }

    // Check if code is unique
    const isUnique = await isBrandCodeUnique(code);
    if (!isUnique) {
      return NextResponse.json(
        { error: "Brand code already exists" },
        { status: 400 }
      );
    }

    const newBrand = await createBrand({
      id: randomUUID(),
      code,
      nameHe,
      nameEn: nameEn || null,
      description: description || null,
      logoUrl: logoUrl || null,
      website: website || null,
      contactEmail: contactEmail || null,
      contactPhone: contactPhone || null,
      address: address || null,
      isActive: isActive !== undefined ? isActive : true,
      createdBy: user.id,
    });

    return NextResponse.json({ brand: newBrand }, { status: 201 });
  } catch (error) {
    console.error("Error creating brand:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
