/**
 * BKMV Small Suppliers - ספקים קטנים ללא עמלה
 *
 * Names marked as small suppliers are included in the commission-revenue
 * purchase percentage report, but they don't have a formal supplier record
 * and no commission is calculated for them.
 *
 * Marking is manual-only: admins mark unmatched BKMV names via the review UI.
 * On reprocessing, previously marked names are auto-tagged as "small_supplier".
 */

import { database } from "@/db";
import {
  bkmvSmallSupplier,
  type BkmvSmallSupplier,
  type CreateBkmvSmallSupplierData,
} from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";
import { normalizeName } from "@/lib/franchisee-matcher";

/**
 * Normalize a supplier name for consistent matching
 */
function normalizeSupplierName(name: string): string {
  return normalizeName(name);
}

/**
 * Get all small supplier entries
 */
export async function getAllSmallSuppliers(): Promise<BkmvSmallSupplier[]> {
  return database
    .select()
    .from(bkmvSmallSupplier)
    .orderBy(desc(bkmvSmallSupplier.createdAt)) as unknown as Promise<BkmvSmallSupplier[]>;
}

/**
 * Get a small supplier entry by name (if exists)
 * @param name - The name to look up (will be normalized)
 */
export async function getSmallSupplierByName(name: string): Promise<BkmvSmallSupplier | null> {
  const normalized = normalizeSupplierName(name);
  const results = (await database
    .select()
    .from(bkmvSmallSupplier)
    .where(eq(bkmvSmallSupplier.normalizedName, normalized))
    .limit(1)) as unknown as BkmvSmallSupplier[];
  return results[0] || null;
}

/**
 * Check if a name is marked as small supplier
 * @param name - The name to check (will be normalized)
 */
export async function isSmallSupplier(name: string): Promise<boolean> {
  const normalized = normalizeSupplierName(name);
  const results = (await database
    .select()
    .from(bkmvSmallSupplier)
    .where(eq(bkmvSmallSupplier.normalizedName, normalized))
    .limit(1)) as unknown as BkmvSmallSupplier[];
  return results.length > 0;
}

/**
 * Add a name as small supplier
 * @param name - The name to mark
 * @param createdBy - User ID of who added it (optional)
 * @param notes - Optional notes
 * @returns The created entry, or null if already exists
 */
export async function addSmallSupplier(
  name: string,
  createdBy?: string,
  notes?: string
): Promise<BkmvSmallSupplier | null> {
  const normalized = normalizeSupplierName(name);

  // Check if already exists
  const existing = await getSmallSupplierByName(name);
  if (existing) {
    return null;
  }

  const data: CreateBkmvSmallSupplierData = {
    id: randomUUID(),
    name: name.trim(),
    normalizedName: normalized,
    createdBy: createdBy || null,
    notes: notes || null,
  };

  await database.insert(bkmvSmallSupplier).values(data);

  const results = (await database
    .select()
    .from(bkmvSmallSupplier)
    .where(eq(bkmvSmallSupplier.id, data.id))
    .limit(1)) as unknown as BkmvSmallSupplier[];
  return results[0] || null;
}

/**
 * Remove a small supplier entry by ID
 * @returns true if removed, false if not found
 */
export async function removeSmallSupplier(id: string): Promise<boolean> {
  const result = await database
    .delete(bkmvSmallSupplier)
    .where(eq(bkmvSmallSupplier.id, id));
  return (result as unknown as { rowCount?: number }).rowCount !== 0;
}

/**
 * Remove a small supplier entry by name
 * @param name - The name to remove (will be normalized)
 * @returns true if removed, false if not found
 */
export async function removeSmallSupplierByName(name: string): Promise<boolean> {
  const normalized = normalizeSupplierName(name);
  const result = await database
    .delete(bkmvSmallSupplier)
    .where(eq(bkmvSmallSupplier.normalizedName, normalized));
  return (result as unknown as { rowCount?: number }).rowCount !== 0;
}

/**
 * Get all small supplier normalized names as a Set for quick lookup
 */
export async function getSmallSupplierNamesSet(): Promise<Set<string>> {
  const entries = await getAllSmallSuppliers();
  return new Set(entries.map((e) => e.normalizedName));
}
