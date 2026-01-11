import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import { getBrands, getActiveBrands, createBrand, getBrandStats, isBrandCodeUnique } from "@/data-access/brands";
import { randomUUID } from "crypto";

/**
 * GET /api/brands - Get all brands (Admin/Super User only)
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
      createdBy: session.user.id,
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
