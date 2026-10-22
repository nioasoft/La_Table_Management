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
import { getSupplierById } from "@/data-access/suppliers";
import { reprocessOpenFilesAfterVatChange } from "@/data-access/supplier-file-reprocess";
import { productVatUpdateSchema } from "@/schemas/supplier-products";

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
 * Bulk update VAT status for products, then re-run the supplier's files in
 * open periods so the reconciliation sees the new flags.
 * Body: { updates: [{ id: string, vatApplicable: boolean }] }
 */
export async function PATCH(
  request: NextRequest,
  { params }: { params: Promise<{ supplierId: string }> }
) {
  const authResult = await requireAdminOrSuperUser(request);
  if (isAuthError(authResult)) return authResult;

  const { supplierId } = await params;

  const parsed = productVatUpdateSchema.safeParse(await request.json().catch(() => null));
  if (!parsed.success) {
    return NextResponse.json(
      { error: "updates array is required" },
      { status: 400 }
    );
  }

  const updated = await updateProductVatStatus(supplierId, parsed.data.updates);

  // Per-item VAT only exists for vat-exempt suppliers (e.g. ALE_ALE)
  const sup = updated > 0 ? await getSupplierById(supplierId) : null;
  const reprocess = sup?.vatExempt
    ? await reprocessOpenFilesAfterVatChange(supplierId).catch((err: unknown) => {
        // The flags are saved — report the reprocess failure, don't fail the save
        console.error(`[vat-reprocess] supplier ${supplierId}:`, err);
        return { recalculated: 0, failed: 1 };
      })
    : { recalculated: 0, failed: 0 };

  return NextResponse.json({ updated, ...reprocess });
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
