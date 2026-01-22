import { database } from "@/db";
import {
  franchisee,
  franchiseeStatusHistory,
  brand,
  user,
  contact,
  type Franchisee,
  type CreateFranchiseeData,
  type UpdateFranchiseeData,
  type FranchiseeStatus,
  type FranchiseeStatusHistory,
  type CreateFranchiseeStatusHistoryData,
  type Contact,
  type Brand,
} from "@/db/schema";
import { eq, desc, and, sql, inArray, count } from "drizzle-orm";
import { getAllFranchiseeReminderCounts } from "./franchiseeImportantDates";
import { logFranchiseeStatusChange, type AuditContext } from "./auditLog";
import {
  type PaginationParams,
  type PaginatedResult,
  normalizePaginationParams,
  createPaginatedResult,
} from "@/lib/pagination";
import {
  matchFranchiseeName,
  matchFranchiseeNames,
  type FranchiseeMatchResult,
  type BatchMatchResult,
  type MatcherConfig,
} from "@/lib/franchisee-matcher";

/**
 * Franchisee with brand information
 */
export type FranchiseeWithBrand = Franchisee & {
  brand: {
    id: string;
    code: string;
    nameHe: string;
    nameEn: string | null;
  } | null;
};

/**
 * Franchisee with brand information and contacts
 */
export type FranchiseeWithBrandAndContacts = FranchiseeWithBrand & {
  contacts: Contact[];
};

/**
 * Get all franchisees from the database with brand info
 */
export async function getFranchisees(): Promise<FranchiseeWithBrand[]> {
  const results = await database
    .select({
      franchisee: franchisee,
      brand: {
        id: brand.id,
        code: brand.code,
        nameHe: brand.nameHe,
        nameEn: brand.nameEn,
      },
    })
    .from(franchisee)
    .leftJoin(brand, eq(franchisee.brandId, brand.id))
    .orderBy(desc(franchisee.createdAt));

  return results.map((r) => ({
    ...r.franchisee,
    brand: r.brand,
  }));
}

/**
 * Get all franchisees from the database with brand info and contacts
 */
export async function getFranchiseesWithContacts(): Promise<FranchiseeWithBrandAndContacts[]> {
  const results = await database
    .select({
      franchisee: franchisee,
      brand: {
        id: brand.id,
        code: brand.code,
        nameHe: brand.nameHe,
        nameEn: brand.nameEn,
      },
    })
    .from(franchisee)
    .leftJoin(brand, eq(franchisee.brandId, brand.id))
    .orderBy(desc(franchisee.createdAt));

  // Get all contacts for these franchisees
  const franchiseeIds = results.map((r) => r.franchisee.id);
  const allContacts = franchiseeIds.length > 0
    ? await database
        .select()
        .from(contact)
        .where(inArray(contact.franchiseeId, franchiseeIds))
    : [];

  // Group contacts by franchisee ID
  const contactsByFranchisee = allContacts.reduce((acc, c) => {
    if (c.franchiseeId) {
      if (!acc[c.franchiseeId]) {
        acc[c.franchiseeId] = [];
      }
      acc[c.franchiseeId].push(c);
    }
    return acc;
  }, {} as Record<string, Contact[]>);

  return results.map((r) => ({
    ...r.franchisee,
    brand: r.brand,
    contacts: contactsByFranchisee[r.franchisee.id] || [],
  }));
}

/**
 * Get franchisees with brand info and contacts - PAGINATED
 * Optimized for large datasets with offset-based pagination
 *
 * @param params - Pagination parameters (page, limit)
 * @returns Paginated result with franchisees and pagination metadata
 */
export async function getFranchiseesWithContactsPaginated(
  params: PaginationParams = {}
): Promise<PaginatedResult<FranchiseeWithBrandAndContacts>> {
  const { page, limit, offset } = normalizePaginationParams(params);

  // Get total count first
  const [countResult] = await database
    .select({ total: count() })
    .from(franchisee);
  const totalCount = countResult?.total ?? 0;

  // Get paginated franchisees
  const results = await database
    .select({
      franchisee: franchisee,
      brand: {
        id: brand.id,
        code: brand.code,
        nameHe: brand.nameHe,
        nameEn: brand.nameEn,
      },
    })
    .from(franchisee)
    .leftJoin(brand, eq(franchisee.brandId, brand.id))
    .orderBy(desc(franchisee.createdAt))
    .limit(limit)
    .offset(offset);

  // Get contacts for these franchisees
  const franchiseeIds = results.map((r) => r.franchisee.id);
  const allContacts =
    franchiseeIds.length > 0
      ? await database
          .select()
          .from(contact)
          .where(inArray(contact.franchiseeId, franchiseeIds))
      : [];

  // Group contacts by franchisee ID
  const contactsByFranchisee = allContacts.reduce((acc, c) => {
    if (c.franchiseeId) {
      if (!acc[c.franchiseeId]) {
        acc[c.franchiseeId] = [];
      }
      acc[c.franchiseeId].push(c);
    }
    return acc;
  }, {} as Record<string, Contact[]>);

  const data = results.map((r) => ({
    ...r.franchisee,
    brand: r.brand,
    contacts: contactsByFranchisee[r.franchisee.id] || [],
  }));

  return createPaginatedResult(data, totalCount, { page, limit });
}

/**
 * Get all active franchisees with brand info
 */
export async function getActiveFranchisees(): Promise<FranchiseeWithBrand[]> {
  const results = await database
    .select({
      franchisee: franchisee,
      brand: {
        id: brand.id,
        code: brand.code,
        nameHe: brand.nameHe,
        nameEn: brand.nameEn,
      },
    })
    .from(franchisee)
    .leftJoin(brand, eq(franchisee.brandId, brand.id))
    .where(eq(franchisee.isActive, true))
    .orderBy(desc(franchisee.createdAt));

  return results.map((r) => ({
    ...r.franchisee,
    brand: r.brand,
  }));
}

/**
 * Get franchisees by brand ID with brand info
 */
export async function getFranchiseesByBrand(
  brandId: string
): Promise<FranchiseeWithBrand[]> {
  const results = await database
    .select({
      franchisee: franchisee,
      brand: {
        id: brand.id,
        code: brand.code,
        nameHe: brand.nameHe,
        nameEn: brand.nameEn,
      },
    })
    .from(franchisee)
    .leftJoin(brand, eq(franchisee.brandId, brand.id))
    .where(eq(franchisee.brandId, brandId))
    .orderBy(desc(franchisee.createdAt));

  return results.map((r) => ({
    ...r.franchisee,
    brand: r.brand,
  }));
}

/**
 * Get franchisees by status with brand info
 */
export async function getFranchiseesByStatus(
  status: FranchiseeStatus
): Promise<FranchiseeWithBrand[]> {
  const results = await database
    .select({
      franchisee: franchisee,
      brand: {
        id: brand.id,
        code: brand.code,
        nameHe: brand.nameHe,
        nameEn: brand.nameEn,
      },
    })
    .from(franchisee)
    .leftJoin(brand, eq(franchisee.brandId, brand.id))
    .where(eq(franchisee.status, status))
    .orderBy(desc(franchisee.createdAt));

  return results.map((r) => ({
    ...r.franchisee,
    brand: r.brand,
  }));
}

/**
 * Get a single franchisee by ID with brand info
 */
export async function getFranchiseeById(
  id: string
): Promise<FranchiseeWithBrand | null> {
  const results = await database
    .select({
      franchisee: franchisee,
      brand: {
        id: brand.id,
        code: brand.code,
        nameHe: brand.nameHe,
        nameEn: brand.nameEn,
      },
    })
    .from(franchisee)
    .leftJoin(brand, eq(franchisee.brandId, brand.id))
    .where(eq(franchisee.id, id))
    .limit(1);

  if (results.length === 0) return null;

  return {
    ...results[0].franchisee,
    brand: results[0].brand,
  };
}

/**
 * Get a single franchisee by code
 */
export async function getFranchiseeByCode(
  code: string
): Promise<Franchisee | null> {
  const results = (await database
    .select()
    .from(franchisee)
    .where(eq(franchisee.code, code))
    .limit(1)) as unknown as Franchisee[];
  return results[0] || null;
}

/**
 * Get a single franchisee by company ID (ח.פ)
 * Used for auto-matching BKMVDATA files
 */
export async function getFranchiseeByCompanyId(
  companyId: string
): Promise<FranchiseeWithBrand | null> {
  if (!companyId || companyId.trim() === '') return null;

  const results = await database
    .select({
      franchisee: franchisee,
      brand: {
        id: brand.id,
        code: brand.code,
        nameHe: brand.nameHe,
        nameEn: brand.nameEn,
      },
    })
    .from(franchisee)
    .leftJoin(brand, eq(franchisee.brandId, brand.id))
    .where(eq(franchisee.companyId, companyId.trim()))
    .limit(1);

  if (results.length === 0) return null;

  return {
    ...results[0].franchisee,
    brand: results[0].brand,
  };
}

/**
 * Create a new franchisee
 * Automatically logs initial status if set
 */
export async function createFranchisee(
  data: CreateFranchiseeData
): Promise<Franchisee> {
  const [newFranchisee] = (await database
    .insert(franchisee)
    .values(data)
    .returning()) as unknown as Franchisee[];

  // Log initial status if set
  if (newFranchisee.status) {
    await createStatusHistoryEntry({
      id: crypto.randomUUID(),
      franchiseeId: newFranchisee.id,
      previousStatus: null,
      newStatus: newFranchisee.status,
      effectiveDate: new Date().toISOString().split("T")[0],
      reason: "Initial status set",
      notes: "Status set during franchisee creation",
      createdBy: data.createdBy || null,
    });
  }

  return newFranchisee;
}

// Extended update data type that includes status change logging fields
export type UpdateFranchiseeDataWithStatusChange = UpdateFranchiseeData & {
  statusChangeReason?: string;
  statusChangeNotes?: string;
  statusEffectiveDate?: string;
};

/**
 * Update an existing franchisee
 * Automatically logs status changes when the status is modified
 * Also creates audit log entries for status changes
 */
export async function updateFranchisee(
  id: string,
  data: UpdateFranchiseeDataWithStatusChange,
  updatedBy?: string,
  auditContext?: AuditContext
): Promise<Franchisee | null> {
  // Get existing franchisee to compare status
  const existingFranchisee = await getFranchiseeById(id);
  if (!existingFranchisee) return null;

  // Extract status change fields (don't save them to franchisee table)
  const {
    statusChangeReason,
    statusChangeNotes,
    statusEffectiveDate,
    ...updateData
  } = data;

  // Check if status is changing
  const oldStatus = existingFranchisee.status;
  const newStatus = updateData.status;

  const isStatusChanging =
    newStatus !== undefined && oldStatus !== newStatus;

  // Update the franchisee
  const results = (await database
    .update(franchisee)
    .set({
      ...updateData,
      updatedAt: new Date(),
    })
    .where(eq(franchisee.id, id))
    .returning()) as unknown as Franchisee[];

  const updatedFranchisee = results[0] || null;

  // Log status change if applicable
  if (updatedFranchisee && isStatusChanging && newStatus !== undefined) {
    await createStatusHistoryEntry({
      id: crypto.randomUUID(),
      franchiseeId: id,
      previousStatus: oldStatus,
      newStatus: newStatus,
      effectiveDate:
        statusEffectiveDate || new Date().toISOString().split("T")[0],
      reason: statusChangeReason || "Status updated",
      notes: statusChangeNotes || null,
      createdBy: updatedBy || null,
    });

    // Also log to comprehensive audit log if context provided
    if (auditContext) {
      await logFranchiseeStatusChange(
        auditContext,
        id,
        existingFranchisee.name,
        oldStatus,
        newStatus,
        statusChangeReason,
        statusChangeNotes
      );
    }
  }

  return updatedFranchisee;
}

/**
 * Delete a franchisee
 */
export async function deleteFranchisee(id: string): Promise<boolean> {
  const result = await database
    .delete(franchisee)
    .where(eq(franchisee.id, id));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Toggle franchisee active status
 */
export async function toggleFranchiseeStatus(
  id: string
): Promise<Franchisee | null> {
  const existing = await getFranchiseeById(id);
  if (!existing) return null;

  const results = (await database
    .update(franchisee)
    .set({
      isActive: !existing.isActive,
      updatedAt: new Date(),
    })
    .where(eq(franchisee.id, id))
    .returning()) as unknown as Franchisee[];
  return results[0] || null;
}

/**
 * Update franchisee status
 */
export async function updateFranchiseeStatus(
  id: string,
  status: FranchiseeStatus
): Promise<Franchisee | null> {
  const results = (await database
    .update(franchisee)
    .set({
      status,
      updatedAt: new Date(),
    })
    .where(eq(franchisee.id, id))
    .returning()) as unknown as Franchisee[];
  return results[0] || null;
}

/**
 * Check if a franchisee code is unique
 */
export async function isFranchiseeCodeUnique(
  code: string,
  excludeId?: string
): Promise<boolean> {
  const existing = await getFranchiseeByCode(code);
  if (!existing) return true;
  if (excludeId && existing.id === excludeId) return true;
  return false;
}

/**
 * Get franchisee statistics
 */
export async function getFranchiseeStats(): Promise<{
  total: number;
  active: number;
  inactive: number;
  pending: number;
  suspended: number;
  terminated: number;
  byBrand: { brandId: string; brandName: string; count: number; activeCount: number }[];
}> {
  const allFranchisees = await getFranchisees();

  const stats = {
    total: allFranchisees.length,
    active: 0,
    inactive: 0,
    pending: 0,
    suspended: 0,
    terminated: 0,
    byBrand: [] as { brandId: string; brandName: string; count: number; activeCount: number }[],
  };

  const brandCounts: Record<string, { brandName: string; count: number; activeCount: number }> = {};

  for (const f of allFranchisees) {
    // Count by status
    switch (f.status) {
      case "active":
        stats.active++;
        break;
      case "inactive":
        stats.inactive++;
        break;
      case "pending":
        stats.pending++;
        break;
      case "suspended":
        stats.suspended++;
        break;
      case "terminated":
        stats.terminated++;
        break;
    }

    // Count by brand
    if (f.brand) {
      if (!brandCounts[f.brand.id]) {
        brandCounts[f.brand.id] = {
          brandName: f.brand.nameHe,
          count: 0,
          activeCount: 0,
        };
      }
      brandCounts[f.brand.id].count++;
      if (f.status === "active") {
        brandCounts[f.brand.id].activeCount++;
      }
    }
  }

  stats.byBrand = Object.entries(brandCounts).map(([brandId, data]) => ({
    brandId,
    brandName: data.brandName,
    count: data.count,
    activeCount: data.activeCount,
  }));

  return stats;
}

// ============================================================================
// COMBINED PAGE DATA FUNCTION (OPTIMIZED - reduces multiple API calls to one)
// ============================================================================

/**
 * Combined page data for franchisees list
 * Fetches all necessary data in parallel to reduce API calls from 3 to 1
 */
export interface FranchiseesPageData {
  franchisees: FranchiseeWithBrandAndContacts[];
  stats: {
    total: number;
    active: number;
    inactive: number;
    pending: number;
    suspended: number;
    terminated: number;
    byBrand: { brandId: string; brandName: string; count: number; activeCount: number }[];
  };
  brands: Brand[];
  reminderCounts: Record<string, number>;
}

/**
 * Get all data needed for the franchisees page in a single call
 * Combines: franchisees with contacts, stats, active brands, and reminder counts
 *
 * @returns Combined page data
 */
export async function getFranchiseesPageData(): Promise<FranchiseesPageData> {
  // Import getActiveBrands here to avoid circular dependency
  const { getActiveBrands } = await import("./brands");

  // Execute all queries in parallel
  const [franchisees, stats, brands, reminderCountsMap] = await Promise.all([
    getFranchiseesWithContacts(),
    getFranchiseeStats(),
    getActiveBrands(),
    getAllFranchiseeReminderCounts(),
  ]);

  // Convert Map to plain object for JSON serialization
  const reminderCounts: Record<string, number> = {};
  for (const [franchiseeId, count] of reminderCountsMap) {
    reminderCounts[franchiseeId] = count;
  }

  return {
    franchisees,
    stats,
    brands,
    reminderCounts,
  };
}

// ============================================================================
// FRANCHISEE STATUS HISTORY FUNCTIONS
// ============================================================================

/**
 * Status history entry with user information
 */
export type StatusHistoryWithUser = FranchiseeStatusHistory & {
  createdByUser: { name: string; email: string } | null;
};

/**
 * Status history entry with franchisee name and user information
 */
export type StatusHistoryWithFranchiseeAndUser = FranchiseeStatusHistory & {
  franchiseeName?: string;
  createdByUser?: { name: string; email: string } | null;
};

/**
 * Create a status history entry
 */
export async function createStatusHistoryEntry(
  data: CreateFranchiseeStatusHistoryData
): Promise<FranchiseeStatusHistory> {
  const [entry] = (await database
    .insert(franchiseeStatusHistory)
    .values(data)
    .returning()) as unknown as FranchiseeStatusHistory[];
  return entry;
}

/**
 * Get status history for a franchisee
 * Returns history entries with user information who made the change
 */
export async function getFranchiseeStatusHistory(
  franchiseeId: string
): Promise<StatusHistoryWithUser[]> {
  const results = await database
    .select({
      id: franchiseeStatusHistory.id,
      franchiseeId: franchiseeStatusHistory.franchiseeId,
      previousStatus: franchiseeStatusHistory.previousStatus,
      newStatus: franchiseeStatusHistory.newStatus,
      effectiveDate: franchiseeStatusHistory.effectiveDate,
      reason: franchiseeStatusHistory.reason,
      notes: franchiseeStatusHistory.notes,
      metadata: franchiseeStatusHistory.metadata,
      createdAt: franchiseeStatusHistory.createdAt,
      createdBy: franchiseeStatusHistory.createdBy,
      createdByUserName: user.name,
      createdByUserEmail: user.email,
    })
    .from(franchiseeStatusHistory)
    .leftJoin(user, eq(franchiseeStatusHistory.createdBy, user.id))
    .where(eq(franchiseeStatusHistory.franchiseeId, franchiseeId))
    .orderBy(desc(franchiseeStatusHistory.createdAt));

  return results.map((row) => ({
    id: row.id,
    franchiseeId: row.franchiseeId,
    previousStatus: row.previousStatus,
    newStatus: row.newStatus,
    effectiveDate: row.effectiveDate,
    reason: row.reason,
    notes: row.notes,
    metadata: row.metadata,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    createdByUser: row.createdByUserName
      ? { name: row.createdByUserName, email: row.createdByUserEmail! }
      : null,
  }));
}

/**
 * Get all status history entries (for admin view)
 * Returns history entries with franchisee name and user information
 */
export async function getAllStatusHistory(): Promise<
  StatusHistoryWithFranchiseeAndUser[]
> {
  const results = await database
    .select({
      id: franchiseeStatusHistory.id,
      franchiseeId: franchiseeStatusHistory.franchiseeId,
      previousStatus: franchiseeStatusHistory.previousStatus,
      newStatus: franchiseeStatusHistory.newStatus,
      effectiveDate: franchiseeStatusHistory.effectiveDate,
      reason: franchiseeStatusHistory.reason,
      notes: franchiseeStatusHistory.notes,
      metadata: franchiseeStatusHistory.metadata,
      createdAt: franchiseeStatusHistory.createdAt,
      createdBy: franchiseeStatusHistory.createdBy,
      franchiseeName: franchisee.name,
      createdByUserName: user.name,
      createdByUserEmail: user.email,
    })
    .from(franchiseeStatusHistory)
    .leftJoin(
      franchisee,
      eq(franchiseeStatusHistory.franchiseeId, franchisee.id)
    )
    .leftJoin(user, eq(franchiseeStatusHistory.createdBy, user.id))
    .orderBy(desc(franchiseeStatusHistory.createdAt));

  return results.map((row) => ({
    id: row.id,
    franchiseeId: row.franchiseeId,
    previousStatus: row.previousStatus,
    newStatus: row.newStatus,
    effectiveDate: row.effectiveDate,
    reason: row.reason,
    notes: row.notes,
    metadata: row.metadata,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    franchiseeName: row.franchiseeName || undefined,
    createdByUser: row.createdByUserName
      ? { name: row.createdByUserName, email: row.createdByUserEmail! }
      : null,
  }));
}

// ============================================================================
// FRANCHISEE FUZZY MATCHING FUNCTIONS
// ============================================================================

// Re-export types for convenience
export type {
  FranchiseeMatchResult,
  BatchMatchResult,
  MatcherConfig,
};

/**
 * Match a single franchisee name from supplier file data
 * Uses the aliases system for fuzzy matching
 *
 * @param name - The name to match
 * @param config - Optional matcher configuration
 * @returns Match result with franchisee and confidence score
 */
export async function matchSingleFranchiseeName(
  name: string,
  config?: Partial<MatcherConfig>
): Promise<FranchiseeMatchResult> {
  // Fetch all franchisees with brand info for matching
  const allFranchisees = await database
    .select()
    .from(franchisee)
    .orderBy(desc(franchisee.createdAt)) as Franchisee[];

  return matchFranchiseeName(name, allFranchisees, config);
}

/**
 * Match multiple franchisee names in batch
 * Optimized for processing supplier files
 *
 * @param names - Array of names to match
 * @param config - Optional matcher configuration
 * @returns Batch match results with summary
 */
export async function matchMultipleFranchiseeNames(
  names: string[],
  config?: Partial<MatcherConfig>
): Promise<BatchMatchResult> {
  // Fetch all franchisees for matching
  const allFranchisees = await database
    .select()
    .from(franchisee)
    .orderBy(desc(franchisee.createdAt)) as Franchisee[];

  return matchFranchiseeNames(names, allFranchisees, config);
}

/**
 * Match franchisee names from supplier file parsed data
 * Returns the original data augmented with match results
 *
 * @param parsedData - Array of parsed rows with franchisee field
 * @param config - Optional matcher configuration
 * @returns Augmented data with match results
 */
export async function matchFranchiseeNamesFromFile<
  T extends { franchisee: string }
>(
  parsedData: T[],
  config?: Partial<MatcherConfig>
): Promise<Array<T & { matchResult: FranchiseeMatchResult }>> {
  // Fetch all franchisees for matching
  const allFranchisees = await database
    .select()
    .from(franchisee)
    .orderBy(desc(franchisee.createdAt)) as Franchisee[];

  // Import and use the matchParsedFileData function
  const { matchParsedFileData } = await import("@/lib/franchisee-matcher");
  return matchParsedFileData(parsedData, allFranchisees, config);
}

/**
 * Update franchisee aliases
 * Useful for adding suggested aliases after matching
 *
 * @param franchiseeId - The franchisee ID to update
 * @param aliases - New array of aliases (replaces existing)
 * @returns Updated franchisee or null if not found
 */
export async function updateFranchiseeAliases(
  franchiseeId: string,
  aliases: string[]
): Promise<Franchisee | null> {
  const results = await database
    .update(franchisee)
    .set({
      aliases,
      updatedAt: new Date(),
    })
    .where(eq(franchisee.id, franchiseeId))
    .returning() as unknown as Franchisee[];

  return results[0] || null;
}

/**
 * Add an alias to an existing franchisee
 * Does not add duplicates
 *
 * @param franchiseeId - The franchisee ID
 * @param alias - The alias to add
 * @returns Updated franchisee or null if not found
 */
export async function addFranchiseeAlias(
  franchiseeId: string,
  alias: string
): Promise<Franchisee | null> {
  // Get existing franchisee
  const existing = await getFranchiseeById(franchiseeId);
  if (!existing) return null;

  // Check if alias already exists
  const existingAliases = existing.aliases || [];
  const normalizedAlias = alias.toLowerCase().trim();

  if (existingAliases.some(a => a.toLowerCase().trim() === normalizedAlias)) {
    // Alias already exists, return existing franchisee
    return existing;
  }

  // Add new alias
  const newAliases = [...existingAliases, alias.trim()];

  return updateFranchiseeAliases(franchiseeId, newAliases);
}

/**
 * Remove an alias from a franchisee
 *
 * @param franchiseeId - The franchisee ID
 * @param alias - The alias to remove
 * @returns Updated franchisee or null if not found
 */
export async function removeFranchiseeAlias(
  franchiseeId: string,
  alias: string
): Promise<Franchisee | null> {
  // Get existing franchisee
  const existing = await getFranchiseeById(franchiseeId);
  if (!existing) return null;

  const existingAliases = existing.aliases || [];
  const normalizedAlias = alias.toLowerCase().trim();

  // Remove the alias
  const newAliases = existingAliases.filter(
    a => a.toLowerCase().trim() !== normalizedAlias
  );

  return updateFranchiseeAliases(franchiseeId, newAliases);
}
