import { database } from "@/db";
import {
  bkmvBlacklist,
  type BkmvBlacklist,
  type CreateBkmvBlacklistData,
} from "@/db/schema";
import { eq, desc } from "drizzle-orm";
import { randomUUID } from "crypto";

/**
 * Normalize a supplier name for consistent matching
 * - Trim whitespace
 * - Convert to lowercase
 * - Remove extra spaces
 */
export function normalizeSupplierName(name: string): string {
  return name
    .trim()
    .toLowerCase()
    .replace(/\s+/g, " ");
}

/**
 * Get all blacklisted names
 */
export async function getAllBlacklisted(): Promise<BkmvBlacklist[]> {
  return database
    .select()
    .from(bkmvBlacklist)
    .orderBy(desc(bkmvBlacklist.createdAt)) as unknown as Promise<BkmvBlacklist[]>;
}

/**
 * Get a blacklist entry by ID
 */
export async function getBlacklistById(id: string): Promise<BkmvBlacklist | null> {
  const results = (await database
    .select()
    .from(bkmvBlacklist)
    .where(eq(bkmvBlacklist.id, id))
    .limit(1)) as unknown as BkmvBlacklist[];
  return results[0] || null;
}

/**
 * Check if a name is blacklisted
 * @param name - The name to check (will be normalized)
 * @returns true if the name is in the blacklist
 */
export async function isBlacklisted(name: string): Promise<boolean> {
  const normalizedName = normalizeSupplierName(name);
  const results = (await database
    .select()
    .from(bkmvBlacklist)
    .where(eq(bkmvBlacklist.normalizedName, normalizedName))
    .limit(1)) as unknown as BkmvBlacklist[];
  return results.length > 0;
}

/**
 * Get blacklist entry by name (if exists)
 * @param name - The name to look up (will be normalized)
 */
export async function getBlacklistByName(name: string): Promise<BkmvBlacklist | null> {
  const normalizedName = normalizeSupplierName(name);
  const results = (await database
    .select()
    .from(bkmvBlacklist)
    .where(eq(bkmvBlacklist.normalizedName, normalizedName))
    .limit(1)) as unknown as BkmvBlacklist[];
  return results[0] || null;
}

/**
 * Add a name to the blacklist
 * @param name - The name to blacklist
 * @param createdBy - User ID of who added it (optional)
 * @param notes - Optional notes explaining why
 * @returns The created blacklist entry, or null if already exists
 */
export async function addToBlacklist(
  name: string,
  createdBy?: string,
  notes?: string
): Promise<BkmvBlacklist | null> {
  const normalizedName = normalizeSupplierName(name);

  // Check if already blacklisted
  const existing = await getBlacklistByName(name);
  if (existing) {
    return null; // Already blacklisted
  }

  const data: CreateBkmvBlacklistData = {
    id: randomUUID(),
    name: name.trim(),
    normalizedName,
    createdBy: createdBy || null,
    notes: notes || null,
  };

  await database.insert(bkmvBlacklist).values(data);
  return getBlacklistById(data.id);
}

/**
 * Remove a name from the blacklist by ID
 * @param id - The blacklist entry ID
 * @returns true if removed, false if not found
 */
export async function removeFromBlacklist(id: string): Promise<boolean> {
  const result = await database
    .delete(bkmvBlacklist)
    .where(eq(bkmvBlacklist.id, id));
  // Check if any row was deleted
  return (result as unknown as { rowCount?: number }).rowCount !== 0;
}

/**
 * Remove a name from the blacklist by name
 * @param name - The name to remove (will be normalized)
 * @returns true if removed, false if not found
 */
export async function removeFromBlacklistByName(name: string): Promise<boolean> {
  const normalizedName = normalizeSupplierName(name);
  const result = await database
    .delete(bkmvBlacklist)
    .where(eq(bkmvBlacklist.normalizedName, normalizedName));
  return (result as unknown as { rowCount?: number }).rowCount !== 0;
}

/**
 * Filter out blacklisted names from a list
 * @param names - Array of names to filter
 * @returns Object with filtered (non-blacklisted) and blacklisted names
 */
export async function filterBlacklistedNames(
  names: string[]
): Promise<{ allowed: string[]; blacklisted: string[] }> {
  const blacklist = await getAllBlacklisted();
  const blacklistedSet = new Set(blacklist.map((b) => b.normalizedName));

  const allowed: string[] = [];
  const blacklisted: string[] = [];

  for (const name of names) {
    const normalizedName = normalizeSupplierName(name);
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
 * Useful for batch operations
 */
export async function getBlacklistedNamesSet(): Promise<Set<string>> {
  const blacklist = await getAllBlacklisted();
  return new Set(blacklist.map((b) => b.normalizedName));
}
