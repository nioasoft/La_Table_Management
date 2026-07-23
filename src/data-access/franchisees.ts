import { database } from "@/db";
import { formatDateAsLocal } from "@/lib/date-utils";
import { normalizeBusinessId } from "@/lib/business-id-utils";
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
  type FranchiseeCategory,
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
  normalizeName,
  type FranchiseeMatchResult,
  type BatchMatchResult,
  type MatcherConfig,
} from "@/lib/franchisee-matcher";
import type { Anomaly } from "@/types/file-anomalies";

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
 * Options for filtering franchisees
 */
export interface GetFranchiseesOptions {
  /** Filter by category. Default: 'regular' to exclude other income sources */
  category?: FranchiseeCategory | "all";
  /** Filter by active status */
  isActive?: boolean;
  /** Filter by brand ID */
  brandId?: string;
  /** Filter by franchisee status */
  status?: FranchiseeStatus;
}

/**
 * Get all franchisees from the database with brand info
 * By default, returns only 'regular' category franchisees (excludes other income sources)
 *
 * @param options - Filter options (category defaults to 'regular')
 */
export async function getFranchisees(
  options: GetFranchiseesOptions = {}
): Promise<FranchiseeWithBrand[]> {
  const { category = "regular", isActive } = options;

  const conditions = [];

  // Filter by category (unless 'all' is specified)
  if (category !== "all") {
    conditions.push(eq(franchisee.category, category));
  }

  // Filter by active status if specified
  if (isActive !== undefined) {
    conditions.push(eq(franchisee.isActive, isActive));
  }

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
    .where(conditions.length > 0 ? and(...conditions) : undefined)
    .orderBy(desc(franchisee.createdAt));

  return results.map((r) => ({
    ...r.franchisee,
    brand: r.brand,
  }));
}

/**
 * Get all "other" income sources (category = 'other')
 * These are non-franchisee entities like Don Pedro that receive commissions
 */
export async function getOtherIncomeSources(): Promise<FranchiseeWithBrand[]> {
  return getFranchisees({ category: "other" });
}

/**
 * Get all franchisees from the database with brand info and contacts
 * By default, returns only 'regular' category franchisees (excludes other income sources)
 *
 * @param options - Filter options (category defaults to 'regular')
 */
export async function getFranchiseesWithContacts(
  options: GetFranchiseesOptions = {}
): Promise<FranchiseeWithBrandAndContacts[]> {
  const { category = "regular", isActive, brandId, status } = options;

  const conditions = [];

  // Filter by category (unless 'all' is specified)
  if (category !== "all") {
    conditions.push(eq(franchisee.category, category));
  }

  // Filter by active status if specified
  if (isActive !== undefined) {
    conditions.push(eq(franchisee.isActive, isActive));
  }

  // Filter by brand ID if specified
  if (brandId) {
    conditions.push(eq(franchisee.brandId, brandId));
  }

  // Filter by status if specified
  if (status) {
    conditions.push(eq(franchisee.status, status));
  }

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
    .where(conditions.length > 0 ? and(...conditions) : undefined)
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
 * By default, returns only 'regular' category franchisees (excludes other income sources)
 *
 * @param params - Pagination parameters (page, limit)
 * @param options - Filter options (category defaults to 'regular')
 * @returns Paginated result with franchisees and pagination metadata
 */
export async function getFranchiseesWithContactsPaginated(
  params: PaginationParams = {},
  options: GetFranchiseesOptions = {}
): Promise<PaginatedResult<FranchiseeWithBrandAndContacts>> {
  const { page, limit, offset } = normalizePaginationParams(params);
  const { category = "regular", isActive } = options;

  const conditions = [];

  // Filter by category (unless 'all' is specified)
  if (category !== "all") {
    conditions.push(eq(franchisee.category, category));
  }

  // Filter by active status if specified
  if (isActive !== undefined) {
    conditions.push(eq(franchisee.isActive, isActive));
  }

  const whereCondition = conditions.length > 0 ? and(...conditions) : undefined;

  // Get total count first (with same filters)
  const [countResult] = await database
    .select({ total: count() })
    .from(franchisee)
    .where(whereCondition);
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
    .where(whereCondition)
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
 * By default, returns only 'regular' category franchisees (excludes other income sources)
 *
 * @param options - Filter options (category defaults to 'regular')
 */
export async function getActiveFranchisees(
  options: Pick<GetFranchiseesOptions, "category"> = {}
): Promise<FranchiseeWithBrand[]> {
  return getFranchisees({ ...options, isActive: true });
}

/**
 * Get franchisees by brand ID with brand info
 * By default, returns only 'regular' category franchisees (excludes other income sources)
 *
 * @param brandId - The brand ID to filter by
 * @param options - Filter options (category defaults to 'regular')
 */
export async function getFranchiseesByBrand(
  brandId: string,
  options: GetFranchiseesOptions = {}
): Promise<FranchiseeWithBrand[]> {
  const { category = "regular", isActive } = options;

  const conditions = [eq(franchisee.brandId, brandId)];

  // Filter by category (unless 'all' is specified)
  if (category !== "all") {
    conditions.push(eq(franchisee.category, category));
  }

  // Filter by active status if specified
  if (isActive !== undefined) {
    conditions.push(eq(franchisee.isActive, isActive));
  }

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
    .where(and(...conditions))
    .orderBy(desc(franchisee.createdAt));

  return results.map((r) => ({
    ...r.franchisee,
    brand: r.brand,
  }));
}

/**
 * Get franchisees by status with brand info
 * By default, returns only 'regular' category franchisees (excludes other income sources)
 *
 * @param status - The status to filter by
 * @param options - Filter options (category defaults to 'regular')
 */
export async function getFranchiseesByStatus(
  status: FranchiseeStatus,
  options: Pick<GetFranchiseesOptions, "category"> = {}
): Promise<FranchiseeWithBrand[]> {
  const { category = "regular" } = options;

  const conditions = [eq(franchisee.status, status)];

  // Filter by category (unless 'all' is specified)
  if (category !== "all") {
    conditions.push(eq(franchisee.category, category));
  }

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
    .where(and(...conditions))
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
 * Get a single franchisee by ID with brand info and contacts
 */
export async function getFranchiseeByIdWithContacts(
  id: string
): Promise<FranchiseeWithBrandAndContacts | null> {
  const result = await getFranchiseeById(id);
  if (!result) return null;

  const contacts = await database
    .select()
    .from(contact)
    .where(eq(contact.franchiseeId, id));

  return {
    ...result,
    contacts,
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
      effectiveDate: formatDateAsLocal(new Date()),
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
        statusEffectiveDate || formatDateAsLocal(new Date()),
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
 * By default, returns stats only for 'regular' category franchisees (excludes other income sources)
 *
 * @param options - Filter options (category defaults to 'regular')
 */
export async function getFranchiseeStats(
  options: Pick<GetFranchiseesOptions, "category"> = {}
): Promise<{
  total: number;
  active: number;
  inactive: number;
  pending: number;
  suspended: number;
  terminated: number;
  byBrand: { brandId: string; brandName: string; count: number; activeCount: number }[];
}> {
  const allFranchisees = await getFranchisees(options);

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
 * For rows with franchiseeId (e.g., מספר עוסק from supplier files like דגי הקיבוצים),
 * attempts to match by companyId or taxId first before falling back to name matching.
 *
 * @param parsedData - Array of parsed rows with franchisee field and optional franchiseeId
 * @param config - Optional matcher configuration
 * @returns Augmented data with match results
 */
export async function matchFranchiseeNamesFromFile<
  T extends { franchisee: string; franchiseeId?: string }
>(
  parsedData: T[],
  config?: Partial<MatcherConfig>
): Promise<Array<T & { matchResult: FranchiseeMatchResult }>> {
  // Fetch all franchisees for matching
  const allFranchisees = await database
    .select()
    .from(franchisee)
    .orderBy(desc(franchisee.createdAt)) as Franchisee[];

  // Create lookup map for companyId matching (e.g., מספר עוסק from supplier files)
  // Use normalized business IDs as keys to handle format variations (e.g., "123456789-0" vs "123456789")
  const companyIdMap = new Map<string, Franchisee>();

  for (const f of allFranchisees) {
    if (f.companyId) {
      const normalizedId = normalizeBusinessId(f.companyId);
      if (normalizedId) {
        companyIdMap.set(normalizedId, f);
      }
    }
  }

  console.log(`[matchFranchiseeNamesFromFile] Built companyIdMap with ${companyIdMap.size} normalized business IDs`);

  // Import and use the matchParsedFileData function
  const { matchParsedFileData, matchFranchiseeName } = await import("@/lib/franchisee-matcher");

  // Process each row - try franchiseeId matching first, then fall back to name matching
  const results: Array<T & { matchResult: FranchiseeMatchResult }> = [];

  for (const row of parsedData) {
    let matchResult: FranchiseeMatchResult | null = null;

    // First, try to match by franchiseeId (business ID / מספר עוסק) if available
    if (row.franchiseeId) {
      const normalizedBusinessId = normalizeBusinessId(row.franchiseeId);

      if (normalizedBusinessId) {
        // Check companyId map for match using normalized ID
        const companyMatch = companyIdMap.get(normalizedBusinessId);
        if (companyMatch) {
          console.log(`[matchFranchiseeNamesFromFile] Matched by business ID: "${row.franchiseeId}" -> normalized "${normalizedBusinessId}" -> franchisee "${companyMatch.name}"`);
          matchResult = {
            originalName: row.franchisee,
            matchedFranchisee: companyMatch,
            confidence: 1,
            matchType: "exact_code",
            matchedOn: `companyId:${normalizedBusinessId}`,
            requiresReview: false,
            alternatives: [],
          };
        } else {
          console.log(`[matchFranchiseeNamesFromFile] No match for business ID: "${row.franchiseeId}" (normalized: "${normalizedBusinessId}")`);
        }
      }
    }

    // If no franchiseeId match, fall back to name matching
    if (!matchResult) {
      console.log(`[matchFranchiseeNamesFromFile] Falling back to name matching for: "${row.franchisee}"`);
      matchResult = matchFranchiseeName(row.franchisee, allFranchisees, config);
    }

    results.push({
      ...row,
      matchResult,
    });
  }

  return results;
}

/**
 * Same as `matchFranchiseeNamesFromFile`, but also returns aggregated anomalies
 * for the admin pre-save review modal. Use this in upload routes; the original
 * function is preserved for callers that don't need anomaly emission yet.
 */
export async function matchFranchiseeNamesFromFileWithAnomalies<
  T extends {
    franchisee: string;
    franchiseeId?: string;
    rowNumber?: number;
    netAmount?: number;
    grossAmount?: number;
  }
>(
  parsedData: T[],
  config?: Partial<MatcherConfig>
): Promise<{
  rows: Array<T & { matchResult: FranchiseeMatchResult }>;
  anomalies: Anomaly[];
}> {
  const rows = await matchFranchiseeNamesFromFile(parsedData, config);

  // Re-fetch franchisees once for anomaly suggestions. Cheap relative to the
  // overall upload pipeline (single SELECT, ~100 rows for La Table).
  const allFranchisees = (await database
    .select()
    .from(franchisee)
    .orderBy(desc(franchisee.createdAt))) as Franchisee[];

  const anomalies = computeMatchAnomalies(rows, allFranchisees);
  return { rows, anomalies };
}

/**
 * Derive anomalies from already-resolved match results. Pure (no I/O) so it's
 * safe to call from any caller that already has the matched rows + franchisee
 * list loaded.
 *
 * Groups multiple rows that share the same root cause (e.g., 61 rows with the
 * same unknown business_id collapse to ONE UNKNOWN_BUSINESS_ID anomaly).
 */
export function computeMatchAnomalies<
  T extends {
    franchisee: string;
    franchiseeId?: string;
    rowNumber?: number;
    netAmount?: number;
    grossAmount?: number;
    matchResult: FranchiseeMatchResult;
  }
>(rows: T[], allFranchisees: Franchisee[]): Anomaly[] {
  const anomalies: Anomaly[] = [];

  // ── 1. UNKNOWN_BUSINESS_ID — group by file's biz_id ─────────────────────
  // Each unknown biz_id may map to many file rows. Collapse them into one
  // anomaly per biz_id so the modal stays scannable.
  const unknownGroups = new Map<
    string,
    {
      bizId: string;
      addresses: Set<string>;
      rowNumbers: number[];
      totalAmount: number;
    }
  >();

  for (const r of rows) {
    if (r.matchResult.matchedFranchisee) continue;
    if (!r.franchiseeId) continue;
    const normalized = normalizeBusinessId(r.franchiseeId);
    if (!normalized) continue;
    const existing = unknownGroups.get(normalized) ?? {
      bizId: normalized,
      addresses: new Set<string>(),
      rowNumbers: [],
      totalAmount: 0,
    };
    if (r.franchisee) existing.addresses.add(r.franchisee.trim());
    if (typeof r.rowNumber === "number") existing.rowNumbers.push(r.rowNumber);
    existing.totalAmount += r.netAmount ?? r.grossAmount ?? 0;
    unknownGroups.set(normalized, existing);
  }

  for (const group of unknownGroups.values()) {
    const suggestions = suggestFranchiseesForUnknownBizId(
      Array.from(group.addresses),
      allFranchisees
    );

    const actions: Anomaly["suggestedActions"] = [];
    const top = suggestions[0];
    if (top) {
      actions.push({
        type: "update_franchisee_company_id",
        franchiseeId: top.id,
        franchiseeName: top.name,
        currentCompanyId: top.companyId ?? null,
        newCompanyId: group.bizId,
        labelHe: `עדכן ח.פ. של "${top.name}" ל-${group.bizId}`,
      });
    }
    actions.push({
      type: "manual_match_required",
      labelHe: "התאם ידנית",
    });

    const addressList = Array.from(group.addresses).filter(Boolean).join(", ");
    anomalies.push({
      code: "UNKNOWN_BUSINESS_ID",
      severity: "warning",
      messageHe:
        `${group.rowNumbers.length} שורות (${formatIls(Math.round(group.totalAmount))}) ` +
        `עם ח.פ. ${group.bizId} שלא רשום במערכת` +
        (addressList ? ` (כתובת בקובץ: ${addressList})` : ""),
      details: {
        explanationHe:
          "ה-parser זיהה את השורות, אך לא נמצא פרנצ'ייז עם ח.פ. תואם. " +
          "ייתכן שהפרנצ'ייז הזה לא נוצר עדיין, ששינה ח.פ., או שהספק שולח לישות אחרת. " +
          "אם יש פרנצ'ייז במערכת עם השם הקרוב, ניתן לעדכן את ה-ח.פ. שלו בלחיצה.",
        bizId: group.bizId,
        addresses: Array.from(group.addresses),
        suggestions: suggestions.map((s) => ({
          id: s.id,
          name: s.name,
          companyId: s.companyId,
          score: s.score,
        })),
      },
      suggestedActions: actions,
      affectedRowNumbers: group.rowNumbers,
      affectedAmount: Math.round(group.totalAmount),
    });
  }

  // ── 2. BIZ_ID_MISMATCH — matched by name, but file's biz_id ≠ stored ─────
  for (const r of rows) {
    const matched = r.matchResult.matchedFranchisee;
    if (!matched) continue;
    if (!r.franchiseeId) continue;
    if (r.matchResult.matchType === "exact_code") continue; // matched on biz_id, no mismatch
    const fileNorm = normalizeBusinessId(r.franchiseeId);
    const dbNorm = normalizeBusinessId(matched.companyId ?? "");
    if (!fileNorm || !dbNorm) continue;
    if (fileNorm === dbNorm) continue;

    anomalies.push({
      code: "BIZ_ID_MISMATCH",
      severity: "warning",
      messageHe:
        `התאמה לפי שם: "${matched.name}" — אך ח.פ. בקובץ (${fileNorm}) שונה מהרשום (${dbNorm}).`,
      details: {
        explanationHe:
          "השם תואם אבל ה-ח.פ. שונה. ייתכן שהפרנצ'ייז שינה ישות חוקית (חברה חדשה) או שהספק שולח לח.פ. שגוי. " +
          "כדאי לאמת לפני שמירה.",
        franchiseeId: matched.id,
        franchiseeName: matched.name,
        fileBizId: fileNorm,
        storedCompanyId: dbNorm,
      },
      suggestedActions: [
        {
          type: "update_franchisee_company_id",
          franchiseeId: matched.id,
          franchiseeName: matched.name,
          currentCompanyId: matched.companyId ?? null,
          newCompanyId: fileNorm,
          labelHe: `עדכן ח.פ. של "${matched.name}" ל-${fileNorm}`,
        },
        { type: "acknowledge_only", labelHe: "הבנתי, להמשיך" },
      ],
      affectedRowNumbers:
        typeof r.rowNumber === "number" ? [r.rowNumber] : undefined,
      affectedAmount: r.netAmount ?? r.grossAmount,
    });
  }

  // ── 3. LOW_CONFIDENCE_MATCH — fuzzy match below 0.85 ─────────────────────
  for (const r of rows) {
    const matched = r.matchResult.matchedFranchisee;
    if (!matched) continue;
    if (r.matchResult.confidence >= 0.85) continue;
    anomalies.push({
      code: "LOW_CONFIDENCE_MATCH",
      severity: "warning",
      messageHe:
        `התאמה בביטחון נמוך (${Math.round(r.matchResult.confidence * 100)}%): "${r.franchisee}" → "${matched.name}".`,
      details: {
        explanationHe: "התאמה זו דורשת אישור ידני לפני שמירה.",
        originalName: r.franchisee,
        matchedName: matched.name,
        confidence: r.matchResult.confidence,
      },
      suggestedActions: [
        { type: "manual_match_required", labelHe: "אישור ידני" },
      ],
      affectedRowNumbers:
        typeof r.rowNumber === "number" ? [r.rowNumber] : undefined,
      affectedAmount: r.netAmount ?? r.grossAmount,
    });
  }

  // ── 4. INACTIVE_FRANCHISEE_MATCHED ───────────────────────────────────────
  for (const r of rows) {
    const matched = r.matchResult.matchedFranchisee;
    if (!matched) continue;
    if (matched.isActive !== false && matched.status !== "inactive") continue;
    anomalies.push({
      code: "INACTIVE_FRANCHISEE_MATCHED",
      severity: "warning",
      messageHe: `הותאם לפרנצ'ייז לא פעיל: "${matched.name}".`,
      details: {
        explanationHe:
          "הפרנצ'ייז המתאים מסומן כלא פעיל. ודאי שהשמירה רצויה.",
        franchiseeId: matched.id,
        franchiseeName: matched.name,
        status: matched.status,
        isActive: matched.isActive,
      },
      suggestedActions: [
        { type: "acknowledge_only", labelHe: "הבנתי, להמשיך" },
      ],
      affectedRowNumbers:
        typeof r.rowNumber === "number" ? [r.rowNumber] : undefined,
      affectedAmount: r.netAmount ?? r.grossAmount,
    });
  }

  return anomalies;
}

/**
 * Suggest up to 3 franchisees that look textually similar to the unknown
 * supplier-side address(es), even below the matcher's normal threshold —
 * the goal is to give the admin a 1-click path to update the right
 * franchisee's company_id, not to auto-match.
 */
function suggestFranchiseesForUnknownBizId(
  addresses: string[],
  allFranchisees: Franchisee[]
): Array<{
  id: string;
  name: string;
  companyId: string | null;
  score: number;
}> {
  if (addresses.length === 0 || allFranchisees.length === 0) return [];

  const scored = allFranchisees.map((f) => {
    const score = Math.max(
      ...addresses.map((addr) => tokenOverlapScore(addr, f.name))
    );
    return {
      id: f.id,
      name: f.name,
      companyId: f.companyId,
      score,
    };
  });

  return scored
    .filter((s) => s.score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, 3);
}

/**
 * Lightweight token-overlap score [0..1] for Hebrew strings. Splits both
 * sides into whitespace-delimited tokens (after lowercase + trim), counts
 * shared tokens, normalizes by the smaller side. Good enough for "רעננה"
 * vs "קינג קונג רעננה" → 1.0 (full containment of the input tokens).
 */
function tokenOverlapScore(a: string, b: string): number {
  const tokenize = (s: string): Set<string> =>
    new Set(
      s
        .toLowerCase()
        .replace(/[.,\-_'"()[\]{}!?:;#@&*+=/\\<>|`~^]/g, " ")
        .split(/\s+/)
        .filter(Boolean)
    );
  const ta = tokenize(a);
  const tb = tokenize(b);
  if (ta.size === 0 || tb.size === 0) return 0;
  let shared = 0;
  for (const t of ta) if (tb.has(t)) shared++;
  return shared / Math.min(ta.size, tb.size);
}

function formatIls(n: number): string {
  return new Intl.NumberFormat("he-IL", {
    style: "currency",
    currency: "ILS",
    maximumFractionDigits: 0,
  }).format(n);
}

export interface AliasCollision {
  alias: string;
  ownerId: string;
  ownerName: string;
}

/**
 * Pure collision check: which of `candidates` already belong (after
 * normalizeName) to a DIFFERENT franchisee — via its name, code, or aliases.
 * Same normalization semantics as the matcher and the weekly
 * franchisee-alias-collision cron, so "blocked at save" === "would have
 * misrouted at match time".
 */
export function findCollidingAliases(
  candidates: string[],
  owners: Array<{ id: string; name: string; code: string | null; aliases: string[] | null }>,
  excludeFranchiseeId?: string
): AliasCollision[] {
  const ownerByNorm = new Map<string, { id: string; name: string }>();
  for (const o of owners) {
    if (o.id === excludeFranchiseeId) continue;
    for (const raw of [o.name, o.code, ...(o.aliases ?? [])]) {
      if (!raw) continue;
      const norm = normalizeName(raw);
      if (!norm || norm.length < 3) continue;
      if (!ownerByNorm.has(norm)) ownerByNorm.set(norm, { id: o.id, name: o.name });
    }
  }

  const collisions: AliasCollision[] = [];
  for (const alias of candidates) {
    const norm = normalizeName(alias ?? "");
    if (!norm) continue;
    const owner = ownerByNorm.get(norm);
    if (owner) collisions.push({ alias, ownerId: owner.id, ownerName: owner.name });
  }
  return collisions;
}

/**
 * DB-backed collision check for alias writes: rejects any candidate alias
 * that is already the name/code/alias of another ACTIVE franchisee.
 * An alias registered in one place must not be registered in another —
 * a shared alias is exactly what misrouted מוצקין's commissions into
 * כרמיאל (Q2 2026).
 */
export async function findAliasCollisions(
  candidates: string[],
  excludeFranchiseeId?: string
): Promise<AliasCollision[]> {
  if (candidates.length === 0) return [];
  const owners = await database
    .select({
      id: franchisee.id,
      name: franchisee.name,
      code: franchisee.code,
      aliases: franchisee.aliases,
    })
    .from(franchisee)
    .where(eq(franchisee.isActive, true));
  return findCollidingAliases(candidates, owners, excludeFranchiseeId);
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

// ============================================================================
// FRANCHISEE REVENUE ACCOUNT FUNCTIONS
// ============================================================================

/**
 * Update franchisee revenue account code
 * Used to save the confirmed revenue account from BKMVDATA for auto-matching in future uploads
 *
 * @param franchiseeId - The franchisee ID to update
 * @param revenueAccountCode - The revenue account code (or null to clear)
 * @returns Updated franchisee or null if not found
 */
export async function updateFranchiseeRevenueAccount(
  franchiseeId: string,
  revenueAccountCode: string | null
): Promise<Franchisee | null> {
  const results = await database
    .update(franchisee)
    .set({
      revenueAccountCode,
      updatedAt: new Date(),
    })
    .where(eq(franchisee.id, franchiseeId))
    .returning() as unknown as Franchisee[];

  return results[0] || null;
}

/**
 * Get franchisee revenue account code
 *
 * @param franchiseeId - The franchisee ID
 * @returns The revenue account code or null
 */
export async function getFranchiseeRevenueAccount(
  franchiseeId: string
): Promise<string | null> {
  const result = await getFranchiseeById(franchiseeId);
  return result?.revenueAccountCode || null;
}
