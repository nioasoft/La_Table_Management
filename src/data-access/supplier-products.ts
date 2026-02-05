/**
 * Data Access Layer for Supplier Products
 *
 * Handles CRUD operations for supplier-level product tracking,
 * including syncing products from parsed files and managing
 * per-item VAT status.
 */

import { database } from "@/db";
import { supplierProduct } from "@/db/schema";
import { eq, and, sql } from "drizzle-orm";
import { nanoid } from "nanoid";

/**
 * Normalize a product name for deduplication
 * Lowercases and trims whitespace
 */
function normalizeProductName(name: string): string {
  return name.toLowerCase().trim();
}

/**
 * Sync product names from a processed supplier file.
 * - New products are inserted with vatApplicable=false
 * - Existing products get lastSeenAt updated
 *
 * @returns Summary of what was added/updated
 */
export async function syncSupplierProducts(
  supplierId: string,
  productNames: string[]
): Promise<{ added: string[]; existing: number; total: number }> {
  if (!productNames.length) {
    return { added: [], existing: 0, total: 0 };
  }

  // Deduplicate by normalized name
  const uniqueProducts = new Map<string, string>();
  for (const name of productNames) {
    const normalized = normalizeProductName(name);
    if (normalized && !uniqueProducts.has(normalized)) {
      uniqueProducts.set(normalized, name);
    }
  }

  // First, load existing normalized names for this supplier
  const existingProducts = await database
    .select({ normalizedName: supplierProduct.normalizedName })
    .from(supplierProduct)
    .where(eq(supplierProduct.supplierId, supplierId));
  const existingNames = new Set(existingProducts.map((p) => p.normalizedName));

  const added: string[] = [];
  let existing = 0;

  for (const [normalizedName, originalName] of uniqueProducts) {
    const isNew = !existingNames.has(normalizedName);

    await database
      .insert(supplierProduct)
      .values({
        id: nanoid(),
        supplierId,
        name: originalName,
        normalizedName,
        vatApplicable: false,
        lastSeenAt: new Date(),
        createdAt: new Date(),
      })
      .onConflictDoUpdate({
        target: [supplierProduct.supplierId, supplierProduct.normalizedName],
        set: {
          lastSeenAt: new Date(),
        },
      });

    if (isNew) {
      added.push(originalName);
    } else {
      existing++;
    }
  }

  return {
    added,
    existing,
    total: uniqueProducts.size,
  };
}

/**
 * Get all products for a supplier, sorted by name
 */
export async function getSupplierProducts(
  supplierId: string,
  search?: string
) {
  const products = await database
    .select()
    .from(supplierProduct)
    .where(eq(supplierProduct.supplierId, supplierId))
    .orderBy(supplierProduct.name);

  if (search) {
    const normalizedSearch = normalizeProductName(search);
    return products.filter((p) =>
      p.normalizedName.includes(normalizedSearch)
    );
  }

  return products;
}

/**
 * Get a Set of product names that have vatApplicable=true for a supplier.
 * Used by parsers to determine per-item VAT calculation.
 */
export async function getVatProductNames(
  supplierId: string
): Promise<Set<string>> {
  const products = await database
    .select({ name: supplierProduct.name })
    .from(supplierProduct)
    .where(
      and(
        eq(supplierProduct.supplierId, supplierId),
        eq(supplierProduct.vatApplicable, true)
      )
    );

  return new Set(products.map((p) => p.name));
}

/**
 * Bulk update VAT status for products
 */
export async function updateProductVatStatus(
  updates: Array<{ id: string; vatApplicable: boolean }>
): Promise<number> {
  let updated = 0;

  for (const { id, vatApplicable } of updates) {
    const result = await database
      .update(supplierProduct)
      .set({ vatApplicable })
      .where(eq(supplierProduct.id, id));

    if (result.rowCount && result.rowCount > 0) {
      updated++;
    }
  }

  return updated;
}

/**
 * Get product stats for a supplier
 */
export async function getSupplierProductStats(supplierId: string) {
  const result = await database
    .select({
      total: sql<number>`count(*)::int`,
      vatCount: sql<number>`count(*) filter (where ${supplierProduct.vatApplicable} = true)::int`,
      exemptCount: sql<number>`count(*) filter (where ${supplierProduct.vatApplicable} = false)::int`,
    })
    .from(supplierProduct)
    .where(eq(supplierProduct.supplierId, supplierId));

  return result[0] ?? { total: 0, vatCount: 0, exemptCount: 0 };
}
