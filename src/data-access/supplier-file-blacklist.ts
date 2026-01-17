import { database } from "@/db";
import {
  supplierFileBlacklist,
  supplier,
  user,
  type SupplierFileBlacklist,
  type CreateSupplierFileBlacklistData,
} from "@/db/schema";
import { eq, and, desc, or, isNull } from "drizzle-orm";
import { randomUUID } from "crypto";

// Extended type with supplier and creator info
export type SupplierFileBlacklistWithDetails = SupplierFileBlacklist & {
  supplierName: string | null;
  createdByName: string | null;
  createdByEmail: string | null;
};

/**
 * Normalize a franchisee name for consistent matching
 * - Trim whitespace
 * - Convert to lowercase
 * - Remove extra spaces
 */
export function normalizeSupplierFileName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Get all blacklisted names with optional supplier filter
 */
export async function getAllBlacklisted(
  supplierId?: string
): Promise<SupplierFileBlacklistWithDetails[]> {
  const conditions = [];

  if (supplierId) {
    // Get entries specific to this supplier or global entries (null supplierId)
    conditions.push(
      or(
        eq(supplierFileBlacklist.supplierId, supplierId),
        isNull(supplierFileBlacklist.supplierId)
      )
    );
  }

  const results = await database
    .select({
      id: supplierFileBlacklist.id,
      name: supplierFileBlacklist.name,
      normalizedName: supplierFileBlacklist.normalizedName,
      supplierId: supplierFileBlacklist.supplierId,
      notes: supplierFileBlacklist.notes,
      createdBy: supplierFileBlacklist.createdBy,
      createdAt: supplierFileBlacklist.createdAt,
      supplierName: supplier.name,
    })
    .from(supplierFileBlacklist)
    .leftJoin(supplier, eq(supplierFileBlacklist.supplierId, supplier.id))
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(supplierFileBlacklist.createdAt));

  // Fetch creator info for each result
  const resultsWithCreator = await Promise.all(
    results.map(async (row) => {
      let createdByName: string | null = null;
      let createdByEmail: string | null = null;

      if (row.createdBy) {
        const creatorResult = await database
          .select({ name: user.name, email: user.email })
          .from(user)
          .where(eq(user.id, row.createdBy))
          .limit(1);

        if (creatorResult.length > 0) {
          createdByName = creatorResult[0].name;
          createdByEmail = creatorResult[0].email;
        }
      }

      return {
        ...row,
        createdByName,
        createdByEmail,
      };
    })
  );

  return resultsWithCreator;
}

/**
 * Get a blacklist entry by ID
 */
export async function getBlacklistById(
  id: string
): Promise<SupplierFileBlacklistWithDetails | null> {
  const results = await database
    .select({
      id: supplierFileBlacklist.id,
      name: supplierFileBlacklist.name,
      normalizedName: supplierFileBlacklist.normalizedName,
      supplierId: supplierFileBlacklist.supplierId,
      notes: supplierFileBlacklist.notes,
      createdBy: supplierFileBlacklist.createdBy,
      createdAt: supplierFileBlacklist.createdAt,
      supplierName: supplier.name,
    })
    .from(supplierFileBlacklist)
    .leftJoin(supplier, eq(supplierFileBlacklist.supplierId, supplier.id))
    .where(eq(supplierFileBlacklist.id, id))
    .limit(1);

  if (results.length === 0) return null;

  const row = results[0];

  // Get creator info
  let createdByName: string | null = null;
  let createdByEmail: string | null = null;

  if (row.createdBy) {
    const creatorResult = await database
      .select({ name: user.name, email: user.email })
      .from(user)
      .where(eq(user.id, row.createdBy))
      .limit(1);

    if (creatorResult.length > 0) {
      createdByName = creatorResult[0].name;
      createdByEmail = creatorResult[0].email;
    }
  }

  return {
    ...row,
    createdByName,
    createdByEmail,
  };
}

/**
 * Check if a name is blacklisted
 * @param name - The name to check (will be normalized)
 * @param supplierId - Optional: check for supplier-specific blacklist
 * @returns true if the name is in the blacklist
 */
export async function isBlacklisted(
  name: string,
  supplierId?: string
): Promise<boolean> {
  const normalizedName = normalizeSupplierFileName(name);

  const conditions = [eq(supplierFileBlacklist.normalizedName, normalizedName)];

  if (supplierId) {
    // Check for supplier-specific or global blacklist entry
    conditions.push(
      or(
        eq(supplierFileBlacklist.supplierId, supplierId),
        isNull(supplierFileBlacklist.supplierId)
      )!
    );
  }

  const results = await database
    .select()
    .from(supplierFileBlacklist)
    .where(and(...conditions))
    .limit(1);

  return results.length > 0;
}

/**
 * Get blacklist entry by name (if exists)
 * @param name - The name to look up (will be normalized)
 * @param supplierId - Optional: check for supplier-specific blacklist
 */
export async function getBlacklistByName(
  name: string,
  supplierId?: string
): Promise<SupplierFileBlacklist | null> {
  const normalizedName = normalizeSupplierFileName(name);

  const conditions = [eq(supplierFileBlacklist.normalizedName, normalizedName)];

  if (supplierId) {
    conditions.push(
      or(
        eq(supplierFileBlacklist.supplierId, supplierId),
        isNull(supplierFileBlacklist.supplierId)
      )!
    );
  }

  const results = await database
    .select()
    .from(supplierFileBlacklist)
    .where(and(...conditions))
    .limit(1);

  return results[0] || null;
}

/**
 * Add a name to the blacklist
 * @param name - The name to blacklist
 * @param createdBy - User ID of who added it (optional)
 * @param notes - Optional notes explaining why
 * @param supplierId - Optional: make this specific to a supplier
 * @returns The created blacklist entry, or null if already exists
 */
export async function addToBlacklist(
  name: string,
  createdBy?: string,
  notes?: string,
  supplierId?: string
): Promise<SupplierFileBlacklist | null> {
  const normalizedName = normalizeSupplierFileName(name);

  // Check if already blacklisted with the same normalized name
  // For supplier-specific entries, we still allow global entries with the same name
  const existing = await database
    .select()
    .from(supplierFileBlacklist)
    .where(
      and(
        eq(supplierFileBlacklist.normalizedName, normalizedName),
        supplierId
          ? eq(supplierFileBlacklist.supplierId, supplierId)
          : isNull(supplierFileBlacklist.supplierId)
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return null; // Already blacklisted with same scope
  }

  const data: CreateSupplierFileBlacklistData = {
    id: randomUUID(),
    name: name.trim(),
    normalizedName,
    supplierId: supplierId || null,
    createdBy: createdBy || null,
    notes: notes || null,
  };

  const [newEntry] = await database
    .insert(supplierFileBlacklist)
    .values(data)
    .returning();

  return newEntry;
}

/**
 * Remove a name from the blacklist by ID
 * @param id - The blacklist entry ID
 * @returns true if removed, false if not found
 */
export async function removeFromBlacklist(id: string): Promise<boolean> {
  const result = await database
    .delete(supplierFileBlacklist)
    .where(eq(supplierFileBlacklist.id, id));

  return (result.rowCount ?? 0) > 0;
}

/**
 * Remove a name from the blacklist by name
 * @param name - The name to remove (will be normalized)
 * @param supplierId - Optional: remove only supplier-specific entry
 * @returns true if removed, false if not found
 */
export async function removeFromBlacklistByName(
  name: string,
  supplierId?: string
): Promise<boolean> {
  const normalizedName = normalizeSupplierFileName(name);

  const conditions = [eq(supplierFileBlacklist.normalizedName, normalizedName)];

  if (supplierId) {
    conditions.push(eq(supplierFileBlacklist.supplierId, supplierId));
  } else {
    conditions.push(isNull(supplierFileBlacklist.supplierId));
  }

  const result = await database
    .delete(supplierFileBlacklist)
    .where(and(...conditions));

  return (result.rowCount ?? 0) > 0;
}

/**
 * Filter out blacklisted names from a list
 * @param names - Array of names to filter
 * @param supplierId - Optional: check supplier-specific blacklist
 * @returns Object with filtered (non-blacklisted) and blacklisted names
 */
export async function filterBlacklistedNames(
  names: string[],
  supplierId?: string
): Promise<{ allowed: string[]; blacklisted: string[] }> {
  const blacklist = await getAllBlacklisted(supplierId);
  const blacklistedSet = new Set(blacklist.map((b) => b.normalizedName));

  const allowed: string[] = [];
  const blacklisted: string[] = [];

  for (const name of names) {
    const normalizedName = normalizeSupplierFileName(name);
    if (blacklistedSet.has(normalizedName)) {
      blacklisted.push(name);
    } else {
      allowed.push(name);
    }
  }

  return { allowed, blacklisted };
}

/**
 * Get all blacklisted normalized names as a Set for quick lookup
 * @param supplierId - Optional: include supplier-specific blacklist
 */
export async function getBlacklistedNamesSet(
  supplierId?: string
): Promise<Set<string>> {
  const blacklist = await getAllBlacklisted(supplierId);
  return new Set(blacklist.map((b) => b.normalizedName));
}

/**
 * Update blacklist entry notes
 */
export async function updateBlacklistNotes(
  id: string,
  notes: string
): Promise<SupplierFileBlacklist | null> {
  const [updated] = await database
    .update(supplierFileBlacklist)
    .set({ notes })
    .where(eq(supplierFileBlacklist.id, id))
    .returning();

  return updated || null;
}
