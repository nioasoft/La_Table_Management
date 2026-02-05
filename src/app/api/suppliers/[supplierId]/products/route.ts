import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getSupplierProducts,
  updateProductVatStatus,
  syncSupplierProducts,
  getSupplierProductStats,
} from "@/data-access/supplier-products";

/**
 * GET /api/suppliers/[supplierId]/products
 * List all products for a supplier with optional search filter
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ supplierId: string }> }
) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const { supplierId } = await params;
  const { searchParams } = new URL(request.url);
  const search = searchParams.get("search") || undefined;

  const [products, stats] = await Promise.all([
    getSupplierProducts(supplierId, search),
    getSupplierProductStats(supplierId),
  ]);

  return NextResponse.json({ products, stats });
}

/**
 * PATCH /api/suppliers/[supplierId]/products
 * Bulk update VAT status for products
 * Body: { updates: [{ id: string, vatApplicable: boolean }] }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ supplierId: string }> }
) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  await params; // validate params exist

  const body = await request.json();
  const { updates } = body as {
    updates: Array<{ id: string; vatApplicable: boolean }>;
  };

  if (!Array.isArray(updates) || updates.length === 0) {
    return NextResponse.json(
      { error: "updates array is required" },
      { status: 400 }
    );
  }

  const updated = await updateProductVatStatus(updates);

  return NextResponse.json({ updated });
}

/**
 * POST /api/suppliers/[supplierId]/products
 * Sync products from a processed file
 * Body: { productNames: string[] }
 */
export async function POST(
  request: NextRequest,
  { params }: { params: Promise<{ supplierId: string }> }
) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const { supplierId } = await params;

  const body = await request.json();
  const { productNames } = body as { productNames: string[] };

  if (!Array.isArray(productNames)) {
    return NextResponse.json(
      { error: "productNames array is required" },
      { status: 400 }
    );
  }

  const result = await syncSupplierProducts(supplierId, productNames);

  return NextResponse.json(result);
}
