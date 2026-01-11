import { database } from "@/db";
import {
  supplier,
  supplierBrand,
  supplierCommissionHistory,
  brand,
  user,
  type Supplier,
  type CreateSupplierData,
  type UpdateSupplierData,
  type SupplierBrand,
  type Brand,
  type SupplierCommissionHistory,
  type CreateSupplierCommissionHistoryData,
  type SupplierFileMapping,
  type CommissionException,
} from "@/db/schema";
import { eq, desc, and, inArray } from "drizzle-orm";
import { logCommissionChange, type AuditContext } from "./auditLog";

// Extended supplier type with brands
export type SupplierWithBrands = Supplier & {
  brands: Brand[];
};

/**
 * Get all suppliers from the database
 */
export async function getSuppliers(): Promise<Supplier[]> {
  return database
    .select()
    .from(supplier)
    .orderBy(desc(supplier.createdAt)) as unknown as Promise<Supplier[]>;
}

/**
 * Get all active suppliers
 */
export async function getActiveSuppliers(): Promise<Supplier[]> {
  return database
    .select()
    .from(supplier)
    .where(eq(supplier.isActive, true))
    .orderBy(desc(supplier.createdAt)) as unknown as Promise<Supplier[]>;
}

/**
 * Get all visible (non-hidden) suppliers for commission reports
 * This filters out suppliers like pest control, insurance, payment processing
 * that should not appear in commission reports
 */
export async function getVisibleSuppliers(): Promise<Supplier[]> {
  return database
    .select()
    .from(supplier)
    .where(eq(supplier.isHidden, false))
    .orderBy(desc(supplier.createdAt)) as unknown as Promise<Supplier[]>;
}

/**
 * Get all active and visible suppliers for commission reports
 * This is the primary function to use for report dropdown filters
 */
export async function getActiveVisibleSuppliers(): Promise<Supplier[]> {
  return database
    .select()
    .from(supplier)
    .where(and(eq(supplier.isActive, true), eq(supplier.isHidden, false)))
    .orderBy(desc(supplier.createdAt)) as unknown as Promise<Supplier[]>;
}

/**
 * Get a single supplier by ID
 */
export async function getSupplierById(id: string): Promise<Supplier | null> {
  const results = (await database
    .select()
    .from(supplier)
    .where(eq(supplier.id, id))
    .limit(1)) as unknown as Supplier[];
  return results[0] || null;
}

/**
 * Get a single supplier by ID with associated brands
 */
export async function getSupplierWithBrands(
  id: string
): Promise<SupplierWithBrands | null> {
  const supplierResult = await getSupplierById(id);
  if (!supplierResult) return null;

  const brands = await getSupplierBrands(id);
  return {
    ...supplierResult,
    brands,
  };
}

/**
 * Get a single supplier by code
 */
export async function getSupplierByCode(code: string): Promise<Supplier | null> {
  const results = (await database
    .select()
    .from(supplier)
    .where(eq(supplier.code, code))
    .limit(1)) as unknown as Supplier[];
  return results[0] || null;
}

/**
 * Create a new supplier
 * Automatically logs initial commission rate if set
 */
export async function createSupplier(data: CreateSupplierData): Promise<Supplier> {
  const [newSupplier] = (await database
    .insert(supplier)
    .values(data)
    .returning()) as unknown as Supplier[];

  // Log initial commission rate if set
  if (data.defaultCommissionRate) {
    await createCommissionHistoryEntry({
      id: crypto.randomUUID(),
      supplierId: newSupplier.id,
      previousRate: null,
      newRate: data.defaultCommissionRate,
      effectiveDate: new Date().toISOString().split("T")[0],
      reason: "Initial commission rate set",
      notes: "Commission rate set during supplier creation",
      createdBy: data.createdBy || null,
    });
  }

  return newSupplier;
}

// Extended update data type that includes commission change logging fields and file mapping
export type UpdateSupplierDataWithCommissionChange = UpdateSupplierData & {
  commissionChangeReason?: string;
  commissionChangeNotes?: string;
  commissionEffectiveDate?: string;
  fileMapping?: SupplierFileMapping | null;
  commissionExceptions?: CommissionException[] | null;
};

/**
 * Update an existing supplier
 * Automatically logs commission rate changes when the rate is modified
 * Also creates audit log entries for commission changes
 */
export async function updateSupplier(
  id: string,
  data: UpdateSupplierDataWithCommissionChange,
  updatedBy?: string,
  auditContext?: AuditContext
): Promise<Supplier | null> {
  // Get existing supplier to compare commission rates
  const existingSupplier = await getSupplierById(id);
  if (!existingSupplier) return null;

  // Extract commission change fields (don't save them to supplier table)
  // fileMapping is kept in updateData as it's a valid supplier field
  const {
    commissionChangeReason,
    commissionChangeNotes,
    commissionEffectiveDate,
    ...updateData
  } = data;

  // Check if commission rate is changing
  const oldRate = existingSupplier.defaultCommissionRate;
  const newRate = updateData.defaultCommissionRate;

  const isCommissionChanging =
    newRate !== undefined &&
    ((oldRate === null && newRate !== null) ||
      (oldRate !== null && newRate !== oldRate));

  // Update the supplier
  const results = (await database
    .update(supplier)
    .set({
      ...updateData,
      updatedAt: new Date(),
    })
    .where(eq(supplier.id, id))
    .returning()) as unknown as Supplier[];

  const updatedSupplier = results[0] || null;

  // Log commission rate change if applicable
  if (updatedSupplier && isCommissionChanging && newRate !== undefined && newRate !== null) {
    await createCommissionHistoryEntry({
      id: crypto.randomUUID(),
      supplierId: id,
      previousRate: oldRate,
      newRate: newRate,
      effectiveDate:
        commissionEffectiveDate || new Date().toISOString().split("T")[0],
      reason: commissionChangeReason || "Commission rate updated",
      notes: commissionChangeNotes || null,
      createdBy: updatedBy || null,
    });

    // Also log to comprehensive audit log if context provided
    if (auditContext) {
      await logCommissionChange(
        auditContext,
        id,
        existingSupplier.name,
        oldRate,
        newRate,
        commissionChangeReason,
        commissionChangeNotes
      );
    }
  }

  return updatedSupplier;
}

/**
 * Delete a supplier
 */
export async function deleteSupplier(id: string): Promise<boolean> {
  const result = await database.delete(supplier).where(eq(supplier.id, id));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Toggle supplier active status
 */
export async function toggleSupplierStatus(id: string): Promise<Supplier | null> {
  const existingSupplier = await getSupplierById(id);
  if (!existingSupplier) return null;

  const results = (await database
    .update(supplier)
    .set({
      isActive: !existingSupplier.isActive,
      updatedAt: new Date(),
    })
    .where(eq(supplier.id, id))
    .returning()) as unknown as Supplier[];
  return results[0] || null;
}

/**
 * Toggle supplier hidden status
 * Hidden suppliers are excluded from commission reports
 */
export async function toggleSupplierHidden(id: string): Promise<Supplier | null> {
  const existingSupplier = await getSupplierById(id);
  if (!existingSupplier) return null;

  const results = (await database
    .update(supplier)
    .set({
      isHidden: !existingSupplier.isHidden,
      updatedAt: new Date(),
    })
    .where(eq(supplier.id, id))
    .returning()) as unknown as Supplier[];
  return results[0] || null;
}

/**
 * Check if a supplier code is unique
 */
export async function isSupplierCodeUnique(
  code: string,
  excludeId?: string
): Promise<boolean> {
  const existingSupplier = await getSupplierByCode(code);
  if (!existingSupplier) return true;
  if (excludeId && existingSupplier.id === excludeId) return true;
  return false;
}

/**
 * Get supplier statistics
 */
export async function getSupplierStats(): Promise<{
  total: number;
  active: number;
  inactive: number;
  hidden: number;
}> {
  const allSuppliers = await getSuppliers();

  const stats = {
    total: allSuppliers.length,
    active: 0,
    inactive: 0,
    hidden: 0,
  };

  for (const s of allSuppliers) {
    if (s.isActive) {
      stats.active++;
    } else {
      stats.inactive++;
    }
    if (s.isHidden) {
      stats.hidden++;
    }
  }

  return stats;
}

// ============================================================================
// SUPPLIER-BRAND RELATIONSHIP FUNCTIONS
// ============================================================================

/**
 * Get all brands associated with a supplier
 */
export async function getSupplierBrands(supplierId: string): Promise<Brand[]> {
  const supplierBrands = (await database
    .select({
      brandId: supplierBrand.brandId,
    })
    .from(supplierBrand)
    .where(eq(supplierBrand.supplierId, supplierId))) as unknown as {
    brandId: string;
  }[];

  if (supplierBrands.length === 0) return [];

  const brandIds = supplierBrands.map((sb) => sb.brandId);
  const brands = (await database
    .select()
    .from(brand)
    .where(inArray(brand.id, brandIds))) as unknown as Brand[];

  return brands;
}

/**
 * Set supplier brands (replaces existing associations)
 */
export async function setSupplierBrands(
  supplierId: string,
  brandIds: string[]
): Promise<void> {
  // Delete existing associations
  await database
    .delete(supplierBrand)
    .where(eq(supplierBrand.supplierId, supplierId));

  // Create new associations
  if (brandIds.length > 0) {
    const newAssociations = brandIds.map((brandId) => ({
      id: crypto.randomUUID(),
      supplierId,
      brandId,
    }));

    await database.insert(supplierBrand).values(newAssociations);
  }
}

/**
 * Add a brand to a supplier
 */
export async function addSupplierBrand(
  supplierId: string,
  brandId: string
): Promise<SupplierBrand> {
  const [newAssociation] = (await database
    .insert(supplierBrand)
    .values({
      id: crypto.randomUUID(),
      supplierId,
      brandId,
    })
    .returning()) as unknown as SupplierBrand[];
  return newAssociation;
}

/**
 * Remove a brand from a supplier
 */
export async function removeSupplierBrand(
  supplierId: string,
  brandId: string
): Promise<boolean> {
  const result = await database
    .delete(supplierBrand)
    .where(
      and(
        eq(supplierBrand.supplierId, supplierId),
        eq(supplierBrand.brandId, brandId)
      )
    );
  return (result.rowCount ?? 0) > 0;
}

/**
 * Get suppliers by brand
 */
export async function getSuppliersByBrand(brandId: string): Promise<Supplier[]> {
  const supplierBrands = (await database
    .select({
      supplierId: supplierBrand.supplierId,
    })
    .from(supplierBrand)
    .where(eq(supplierBrand.brandId, brandId))) as unknown as {
    supplierId: string;
  }[];

  if (supplierBrands.length === 0) return [];

  const supplierIds = supplierBrands.map((sb) => sb.supplierId);
  const suppliers = (await database
    .select()
    .from(supplier)
    .where(inArray(supplier.id, supplierIds))
    .orderBy(desc(supplier.createdAt))) as unknown as Supplier[];

  return suppliers;
}

// ============================================================================
// COMMISSION HISTORY FUNCTIONS
// ============================================================================

// Extended commission history type with user info
export type CommissionHistoryWithUser = SupplierCommissionHistory & {
  createdByUser?: { name: string; email: string } | null;
};

// Extended commission history type with supplier and user info
export type CommissionHistoryWithSupplierAndUser = SupplierCommissionHistory & {
  supplierName?: string;
  createdByUser?: { name: string; email: string } | null;
};

/**
 * Create a commission history entry
 */
export async function createCommissionHistoryEntry(
  data: CreateSupplierCommissionHistoryData
): Promise<SupplierCommissionHistory> {
  const [entry] = (await database
    .insert(supplierCommissionHistory)
    .values(data)
    .returning()) as unknown as SupplierCommissionHistory[];
  return entry;
}

/**
 * Get commission history for a supplier
 * Returns history entries with user information who made the change
 */
export async function getSupplierCommissionHistory(
  supplierId: string
): Promise<CommissionHistoryWithUser[]> {
  const results = await database
    .select({
      id: supplierCommissionHistory.id,
      supplierId: supplierCommissionHistory.supplierId,
      previousRate: supplierCommissionHistory.previousRate,
      newRate: supplierCommissionHistory.newRate,
      effectiveDate: supplierCommissionHistory.effectiveDate,
      reason: supplierCommissionHistory.reason,
      notes: supplierCommissionHistory.notes,
      metadata: supplierCommissionHistory.metadata,
      createdAt: supplierCommissionHistory.createdAt,
      createdBy: supplierCommissionHistory.createdBy,
      createdByUserName: user.name,
      createdByUserEmail: user.email,
    })
    .from(supplierCommissionHistory)
    .leftJoin(user, eq(supplierCommissionHistory.createdBy, user.id))
    .where(eq(supplierCommissionHistory.supplierId, supplierId))
    .orderBy(desc(supplierCommissionHistory.createdAt));

  return results.map((row) => ({
    id: row.id,
    supplierId: row.supplierId,
    previousRate: row.previousRate,
    newRate: row.newRate,
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
 * Get all commission history entries (for admin view)
 * Returns history entries with supplier name and user information
 */
export async function getAllCommissionHistory(): Promise<
  CommissionHistoryWithSupplierAndUser[]
> {
  const results = await database
    .select({
      id: supplierCommissionHistory.id,
      supplierId: supplierCommissionHistory.supplierId,
      previousRate: supplierCommissionHistory.previousRate,
      newRate: supplierCommissionHistory.newRate,
      effectiveDate: supplierCommissionHistory.effectiveDate,
      reason: supplierCommissionHistory.reason,
      notes: supplierCommissionHistory.notes,
      metadata: supplierCommissionHistory.metadata,
      createdAt: supplierCommissionHistory.createdAt,
      createdBy: supplierCommissionHistory.createdBy,
      supplierName: supplier.name,
      createdByUserName: user.name,
      createdByUserEmail: user.email,
    })
    .from(supplierCommissionHistory)
    .leftJoin(supplier, eq(supplierCommissionHistory.supplierId, supplier.id))
    .leftJoin(user, eq(supplierCommissionHistory.createdBy, user.id))
    .orderBy(desc(supplierCommissionHistory.createdAt));

  return results.map((row) => ({
    id: row.id,
    supplierId: row.supplierId,
    previousRate: row.previousRate,
    newRate: row.newRate,
    effectiveDate: row.effectiveDate,
    reason: row.reason,
    notes: row.notes,
    metadata: row.metadata,
    createdAt: row.createdAt,
    createdBy: row.createdBy,
    supplierName: row.supplierName ?? undefined,
    createdByUser: row.createdByUserName
      ? { name: row.createdByUserName, email: row.createdByUserEmail! }
      : null,
  }));
}

// ============================================================================
// FILE MAPPING FUNCTIONS
// ============================================================================

/**
 * Get file mapping configuration for a supplier
 */
export async function getSupplierFileMapping(
  supplierId: string
): Promise<SupplierFileMapping | null> {
  const result = await getSupplierById(supplierId);
  return result?.fileMapping || null;
}

/**
 * Update file mapping configuration for a supplier
 */
export async function updateSupplierFileMapping(
  supplierId: string,
  fileMapping: SupplierFileMapping | null
): Promise<Supplier | null> {
  const results = (await database
    .update(supplier)
    .set({
      fileMapping,
      updatedAt: new Date(),
    })
    .where(eq(supplier.id, supplierId))
    .returning()) as unknown as Supplier[];
  return results[0] || null;
}

/**
 * Validate file mapping configuration
 * Returns an array of validation error messages, empty if valid
 */
export function validateFileMapping(
  fileMapping: Partial<SupplierFileMapping>
): string[] {
  const errors: string[] = [];

  if (!fileMapping.fileType) {
    errors.push("File type is required");
  } else if (!["xlsx", "csv", "xls"].includes(fileMapping.fileType)) {
    errors.push("File type must be xlsx, csv, or xls");
  }

  if (!fileMapping.columnMappings) {
    errors.push("Column mappings are required");
  } else {
    if (!fileMapping.columnMappings.franchiseeColumn) {
      errors.push("Franchisee column mapping is required");
    }
    if (!fileMapping.columnMappings.amountColumn) {
      errors.push("Amount column mapping is required");
    }
    if (!fileMapping.columnMappings.dateColumn) {
      errors.push("Date column mapping is required");
    }
  }

  if (fileMapping.headerRow === undefined || fileMapping.headerRow < 1) {
    errors.push("Header row must be a positive number");
  }

  if (fileMapping.dataStartRow === undefined || fileMapping.dataStartRow < 1) {
    errors.push("Data start row must be a positive number");
  }

  if (
    fileMapping.headerRow !== undefined &&
    fileMapping.dataStartRow !== undefined &&
    fileMapping.dataStartRow <= fileMapping.headerRow
  ) {
    errors.push("Data start row must be after header row");
  }

  if (
    fileMapping.rowsToSkip !== undefined &&
    fileMapping.rowsToSkip !== null &&
    fileMapping.rowsToSkip < 0
  ) {
    errors.push("Rows to skip must be a non-negative number");
  }

  return errors;
}
