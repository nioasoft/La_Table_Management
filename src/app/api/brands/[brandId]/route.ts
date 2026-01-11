import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getBrandById,
  updateBrand,
  isBrandCodeUnique,
} from "@/data-access/brands";
import type { UpdateBrandData } from "@/db/schema";

interface RouteContext {
  params: Promise<{ brandId: string }>;
}

/**
 * GET /api/brands/[brandId] - Get a single brand
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;

    // Only admins and super users can view brand details
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { brandId } = await context.params;

    const brand = await getBrandById(brandId);
    if (!brand) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    return NextResponse.json({ brand });
  } catch (error) {
    console.error("Error fetching brand:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * PATCH /api/brands/[brandId] - Update brand details
 */
export async function PATCH(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    const userRole = (session.user as typeof session.user & { role?: string })
      .role;

    // Only admins and super users can update brands
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json({ error: "Forbidden" }, { status: 403 });
    }

    const { brandId } = await context.params;
    const body = await request.json();
    const { code, nameHe, nameEn, description, logoUrl, website, contactEmail, contactPhone, address, isActive } = body;

    // Check if brand exists
    const existingBrand = await getBrandById(brandId);
    if (!existingBrand) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    // If code is being updated, check uniqueness
    if (code && code !== existingBrand.code) {
      const isUnique = await isBrandCodeUnique(code, brandId);
      if (!isUnique) {
        return NextResponse.json(
          { error: "Brand code already exists" },
          { status: 400 }
        );
      }
    }

    const updateData: UpdateBrandData = {};

    if (code !== undefined) updateData.code = code;
    if (nameHe !== undefined) updateData.nameHe = nameHe;
    if (nameEn !== undefined) updateData.nameEn = nameEn;
    if (description !== undefined) updateData.description = description;
    if (logoUrl !== undefined) updateData.logoUrl = logoUrl;
    if (website !== undefined) updateData.website = website;
    if (contactEmail !== undefined) updateData.contactEmail = contactEmail;
    if (contactPhone !== undefined) updateData.contactPhone = contactPhone;
    if (address !== undefined) updateData.address = address;
    if (isActive !== undefined) updateData.isActive = isActive;

    const updatedBrand = await updateBrand(brandId, updateData);
    if (!updatedBrand) {
      return NextResponse.json({ error: "Brand not found" }, { status: 404 });
    }

    return NextResponse.json({ brand: updatedBrand });
  } catch (error) {
    console.error("Error updating brand:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

// Note: DELETE endpoint removed - brands can only be deactivated, not deleted
