/**
 * Data access functions for simplified settlement reconciliation
 *
 * This module provides a unified view comparing supplier-reported amounts
 * with franchisee-reported amounts (from BKMVDATA files).
 */

import { database } from "@/db";
import {
  commission,
  supplier,
  franchisee,
  brand,
  uploadedFile,
  adjustment,
  settlementPeriod,
  auditLog,
  type BkmvProcessingResult,
  type AdjustmentType,
} from "@/db/schema";
import { eq, and, gte, lte, desc, sql, asc, inArray, isNotNull } from "drizzle-orm";

// ============================================================================
// TYPES
// ============================================================================

export interface SettlementSimpleFilters {
  periodStartDate: string;
  periodEndDate: string;
  supplierId?: string;
  franchiseeId?: string;
  brandId?: string;
}

export interface SettlementLineItem {
  // Identifiers
  commissionId: string;
  supplierId: string;
  supplierName: string;
  supplierCode: string;
  franchiseeId: string;
  franchiseeName: string;
  franchiseeCode: string;
  brandId: string;
  brandNameHe: string;

  // Supplier data (from commission table)
  supplierAmount: number;
  supplierNetAmount: number;
  commissionRate: number;
  commissionAmount: number;

  // Franchisee data (from BKMVDATA)
  franchiseeAmount: number | null;
  franchiseeFileId: string | null;
  hasFranchiseeData: boolean;

  // Comparison
  difference: number;
  differencePercent: number | null;
  isMatched: boolean; // difference <= 10

  // Status
  status: string;
  hasAdjustment: boolean;
}

export interface SettlementSummary {
  totalSupplierAmount: number;
  totalFranchiseeAmount: number;
  totalDifference: number;
  totalCommissionAmount: number;
  matchedCount: number;
  unmatchedCount: number;
  totalCount: number;
  periodStartDate: string;
  periodEndDate: string;
  generatedAt: string;
}

export interface SettlementSimpleReport {
  summary: SettlementSummary;
  items: SettlementLineItem[];
}

export interface SaveAdjustmentData {
  commissionId: string;
  adjustmentAmount: number;
  reason: AdjustmentType;
  notes?: string;
  settlementPeriodId?: string;
  createdBy?: string;
}

export interface FilterOption {
  id: string;
  name: string;
  code?: string;
  nameHe?: string;
}

export interface SettlementSimpleFilterOptions {
  suppliers: FilterOption[];
  franchisees: FilterOption[];
  brands: FilterOption[];
}

// ============================================================================
// DATA ACCESS FUNCTIONS
// ============================================================================

/**
 * Get settlement report comparing supplier and franchisee amounts
 */
export async function getSettlementSimpleReport(
  filters: SettlementSimpleFilters
): Promise<SettlementSimpleReport> {
  const { periodStartDate, periodEndDate, supplierId, franchiseeId, brandId } = filters;

  // Build conditions for commission query
  const commissionConditions = [
    eq(supplier.isHidden, false),
    gte(commission.periodStartDate, periodStartDate),
    lte(commission.periodEndDate, periodEndDate),
  ];

  if (supplierId) {
    commissionConditions.push(eq(commission.supplierId, supplierId));
  }

  if (franchiseeId) {
    commissionConditions.push(eq(commission.franchiseeId, franchiseeId));
  }

  if (brandId) {
    commissionConditions.push(eq(franchisee.brandId, brandId));
  }

  // Step 1: Get all commissions for the period
  const commissions = await database
    .select({
      id: commission.id,
      supplierId: commission.supplierId,
      supplierName: supplier.name,
      supplierCode: supplier.code,
      franchiseeId: commission.franchiseeId,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      brandId: franchisee.brandId,
      brandNameHe: brand.nameHe,
      grossAmount: commission.grossAmount,
      netAmount: commission.netAmount,
      commissionRate: commission.commissionRate,
      commissionAmount: commission.commissionAmount,
      status: commission.status,
    })
    .from(commission)
    .innerJoin(supplier, eq(commission.supplierId, supplier.id))
    .innerJoin(franchisee, eq(commission.franchiseeId, franchisee.id))
    .innerJoin(brand, eq(franchisee.brandId, brand.id))
    .where(and(...commissionConditions))
    .orderBy(asc(supplier.name), asc(franchisee.name));

  // Step 2: Get BKMVDATA files for the period with processing results
  const bkmvFiles = await database
    .select({
      id: uploadedFile.id,
      franchiseeId: uploadedFile.franchiseeId,
      bkmvProcessingResult: uploadedFile.bkmvProcessingResult,
    })
    .from(uploadedFile)
    .where(
      and(
        isNotNull(uploadedFile.franchiseeId),
        isNotNull(uploadedFile.bkmvProcessingResult),
        gte(uploadedFile.periodStartDate, periodStartDate),
        lte(uploadedFile.periodEndDate, periodEndDate)
      )
    );

  // Build a map of franchisee + supplier -> amount from BKMVDATA
  // Key format: "franchiseeId:supplierId"
  const bkmvAmountsMap = new Map<string, { amount: number; fileId: string }>();

  for (const file of bkmvFiles) {
    if (!file.franchiseeId || !file.bkmvProcessingResult) continue;

    const result = file.bkmvProcessingResult as BkmvProcessingResult;
    if (!result.supplierMatches) continue;

    for (const match of result.supplierMatches) {
      if (!match.matchedSupplierId) continue;

      const key = `${file.franchiseeId}:${match.matchedSupplierId}`;
      const existing = bkmvAmountsMap.get(key);

      // Sum amounts if multiple entries (shouldn't happen normally but just in case)
      if (existing) {
        bkmvAmountsMap.set(key, {
          amount: existing.amount + match.amount,
          fileId: file.id, // Keep the latest file ID
        });
      } else {
        bkmvAmountsMap.set(key, {
          amount: match.amount,
          fileId: file.id,
        });
      }
    }
  }

  // Step 3: Check which commissions have adjustments
  const commissionIds = commissions.map((c) => c.id);
  const adjustmentsSet = new Set<string>();

  if (commissionIds.length > 0) {
    // Get adjustments linked via metadata
    const adjustments = await database
      .select({
        metadata: adjustment.metadata,
      })
      .from(adjustment)
      .where(
        sql`${adjustment.metadata}->>'commissionId' IN (${sql.join(
          commissionIds.map((id) => sql`${id}`),
          sql`, `
        )})`
      );

    for (const adj of adjustments) {
      const metadata = adj.metadata as { commissionId?: string } | null;
      if (metadata?.commissionId) {
        adjustmentsSet.add(metadata.commissionId);
      }
    }
  }

  // Step 4: Build line items
  const items: SettlementLineItem[] = commissions.map((c) => {
    const key = `${c.franchiseeId}:${c.supplierId}`;
    const bkmvData = bkmvAmountsMap.get(key);

    const supplierAmount = Number(c.grossAmount || 0);
    const franchiseeAmount = bkmvData?.amount ?? null;
    const difference =
      franchiseeAmount !== null ? Math.abs(supplierAmount - franchiseeAmount) : supplierAmount;
    const differencePercent =
      franchiseeAmount !== null && franchiseeAmount > 0
        ? ((supplierAmount - franchiseeAmount) / franchiseeAmount) * 100
        : null;
    const isMatched = franchiseeAmount !== null && difference <= 10;

    return {
      commissionId: c.id,
      supplierId: c.supplierId,
      supplierName: c.supplierName,
      supplierCode: c.supplierCode,
      franchiseeId: c.franchiseeId,
      franchiseeName: c.franchiseeName,
      franchiseeCode: c.franchiseeCode,
      brandId: c.brandId,
      brandNameHe: c.brandNameHe,
      supplierAmount,
      supplierNetAmount: Number(c.netAmount || 0),
      commissionRate: Number(c.commissionRate || 0),
      commissionAmount: Number(c.commissionAmount || 0),
      franchiseeAmount,
      franchiseeFileId: bkmvData?.fileId ?? null,
      hasFranchiseeData: bkmvData !== undefined,
      difference,
      differencePercent,
      isMatched,
      status: c.status,
      hasAdjustment: adjustmentsSet.has(c.id),
    };
  });

  // Step 5: Calculate summary
  const totalSupplierAmount = items.reduce((sum, i) => sum + i.supplierAmount, 0);
  const totalFranchiseeAmount = items.reduce((sum, i) => sum + (i.franchiseeAmount || 0), 0);
  const totalDifference = items.reduce((sum, i) => sum + i.difference, 0);
  const totalCommissionAmount = items.reduce((sum, i) => sum + i.commissionAmount, 0);
  const matchedCount = items.filter((i) => i.isMatched).length;
  const unmatchedCount = items.filter((i) => !i.isMatched).length;

  return {
    summary: {
      totalSupplierAmount,
      totalFranchiseeAmount,
      totalDifference,
      totalCommissionAmount,
      matchedCount,
      unmatchedCount,
      totalCount: items.length,
      periodStartDate,
      periodEndDate,
      generatedAt: new Date().toISOString(),
    },
    items,
  };
}

/**
 * Save an adjustment for a commission discrepancy
 * Uses the existing adjustment table with metadata for commission context
 */
export async function saveSettlementAdjustment(
  data: SaveAdjustmentData
): Promise<{ success: boolean; adjustmentId?: string; error?: string }> {
  try {
    // First, get the commission to find its settlement period
    const [commissionRecord] = await database
      .select({
        settlementPeriodId: commission.settlementPeriodId,
        supplierId: commission.supplierId,
        franchiseeId: commission.franchiseeId,
      })
      .from(commission)
      .where(eq(commission.id, data.commissionId))
      .limit(1);

    if (!commissionRecord) {
      return { success: false, error: "Commission not found" };
    }

    // Get or create settlement period ID
    let settlementPeriodId = commissionRecord.settlementPeriodId;

    // If no settlement period linked, we need one for the adjustment
    if (!settlementPeriodId && data.settlementPeriodId) {
      settlementPeriodId = data.settlementPeriodId;
    }

    // Create a temporary settlement period if needed
    if (!settlementPeriodId) {
      // Find an existing open settlement period or create one
      const [existingPeriod] = await database
        .select({ id: settlementPeriod.id })
        .from(settlementPeriod)
        .where(eq(settlementPeriod.status, "open"))
        .limit(1);

      if (existingPeriod) {
        settlementPeriodId = existingPeriod.id;
      } else {
        return {
          success: false,
          error: "No settlement period available for adjustment",
        };
      }
    }

    // Create the adjustment
    const adjustmentId = crypto.randomUUID();
    await database.insert(adjustment).values({
      id: adjustmentId,
      settlementPeriodId,
      adjustmentType: data.reason,
      amount: data.adjustmentAmount.toString(),
      reason: data.notes || getDefaultReasonText(data.reason),
      description: data.notes,
      metadata: {
        commissionId: data.commissionId,
        supplierId: commissionRecord.supplierId,
        franchiseeId: commissionRecord.franchiseeId,
        source: "settlement-simple",
      },
      createdBy: data.createdBy,
    });

    return { success: true, adjustmentId };
  } catch (error) {
    console.error("Error saving adjustment:", error);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unknown error",
    };
  }
}

/**
 * Get default reason text for adjustment types
 */
function getDefaultReasonText(adjustmentType: AdjustmentType): string {
  const reasons: Record<AdjustmentType, string> = {
    timing: "הפרשי עיתוי",
    deposit: "פיקדון",
    supplier_error: "טעות ספק",
    other: "אחר",
    credit: "זיכוי",
    debit: "חיוב",
    refund: "החזר",
    penalty: "קנס",
    bonus: "בונוס",
  };
  return reasons[adjustmentType] || "אחר";
}

/**
 * Get settlement history from audit log
 */
export async function getSettlementHistory(
  periodStartDate: string,
  periodEndDate: string
): Promise<
  Array<{
    id: string;
    timestamp: Date;
    action: string;
    entityType: string;
    entityId: string;
    entityName: string | null;
    userName: string | null;
    userEmail: string | null;
    beforeValue: unknown;
    afterValue: unknown;
    notes: string | null;
  }>
> {
  const results = await database
    .select({
      id: auditLog.id,
      timestamp: auditLog.timestamp,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      entityName: auditLog.entityName,
      userName: auditLog.userName,
      userEmail: auditLog.userEmail,
      beforeValue: auditLog.beforeValue,
      afterValue: auditLog.afterValue,
      notes: auditLog.notes,
    })
    .from(auditLog)
    .where(
      and(
        inArray(auditLog.entityType, ["commission", "adjustment"]),
        gte(auditLog.timestamp, new Date(periodStartDate)),
        lte(auditLog.timestamp, new Date(periodEndDate + "T23:59:59"))
      )
    )
    .orderBy(desc(auditLog.timestamp))
    .limit(100);

  return results;
}

/**
 * Get filter options for the settlement simple page
 */
export async function getSettlementSimpleFilterOptions(): Promise<SettlementSimpleFilterOptions> {
  // Get active suppliers that have commissions
  const suppliers = await database
    .selectDistinct({
      id: supplier.id,
      name: supplier.name,
      code: supplier.code,
    })
    .from(supplier)
    .innerJoin(commission, eq(supplier.id, commission.supplierId))
    .where(eq(supplier.isActive, true))
    .orderBy(supplier.name);

  // Get active franchisees
  const franchisees = await database
    .selectDistinct({
      id: franchisee.id,
      name: franchisee.name,
      code: franchisee.code,
    })
    .from(franchisee)
    .innerJoin(commission, eq(franchisee.id, commission.franchiseeId))
    .where(eq(franchisee.isActive, true))
    .orderBy(franchisee.name);

  // Get all brands
  const brands = await database
    .select({
      id: brand.id,
      nameHe: brand.nameHe,
      code: brand.code,
    })
    .from(brand)
    .orderBy(brand.nameHe);

  return {
    suppliers: suppliers.map((s) => ({
      id: s.id,
      name: s.name,
      code: s.code,
    })),
    franchisees: franchisees.map((f) => ({
      id: f.id,
      name: f.name,
      code: f.code,
    })),
    brands: brands.map((b) => ({
      id: b.id,
      name: b.nameHe,
      nameHe: b.nameHe,
      code: b.code,
    })),
  };
}

/**
 * Get available settlement periods for dropdown
 */
export async function getAvailableSettlementPeriods(): Promise<
  Array<{ id: string; name: string; startDate: string; endDate: string; status: string }>
> {
  const periods = await database
    .select({
      id: settlementPeriod.id,
      name: settlementPeriod.name,
      startDate: settlementPeriod.periodStartDate,
      endDate: settlementPeriod.periodEndDate,
      status: settlementPeriod.status,
    })
    .from(settlementPeriod)
    .where(inArray(settlementPeriod.status, ["open", "processing", "pending_approval"]))
    .orderBy(desc(settlementPeriod.periodStartDate))
    .limit(10);

  return periods;
}
