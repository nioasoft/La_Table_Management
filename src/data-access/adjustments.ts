import { database } from "@/db";
import {
  adjustment,
  settlementPeriod,
  user,
  type Adjustment,
  type CreateAdjustmentData,
  type UpdateAdjustmentData,
  type AdjustmentType,
} from "@/db/schema";
import { eq, desc, and } from "drizzle-orm";
import {
  logAdjustmentCreate,
  logAdjustmentUpdate,
  logAdjustmentDelete,
  type AuditContext,
} from "./auditLog";

// ============================================================================
// ADJUSTMENT TYPES
// ============================================================================

/**
 * Extended adjustment type with related data
 */
export type AdjustmentWithDetails = Adjustment & {
  settlementPeriod?: {
    id: string;
    name: string;
    franchiseeId: string;
  } | null;
  createdByUser?: { name: string; email: string } | null;
  approvedByUser?: { name: string; email: string } | null;
};

// ============================================================================
// CORE ADJUSTMENT FUNCTIONS
// ============================================================================

/**
 * Get all adjustments
 */
export async function getAdjustments(): Promise<Adjustment[]> {
  return database
    .select()
    .from(adjustment)
    .orderBy(desc(adjustment.createdAt)) as unknown as Promise<Adjustment[]>;
}

/**
 * Get adjustments by settlement period ID
 */
export async function getAdjustmentsBySettlementPeriod(
  settlementPeriodId: string
): Promise<Adjustment[]> {
  return database
    .select()
    .from(adjustment)
    .where(eq(adjustment.settlementPeriodId, settlementPeriodId))
    .orderBy(desc(adjustment.createdAt)) as unknown as Promise<Adjustment[]>;
}

/**
 * Get a single adjustment by ID
 */
export async function getAdjustmentById(id: string): Promise<Adjustment | null> {
  const results = (await database
    .select()
    .from(adjustment)
    .where(eq(adjustment.id, id))
    .limit(1)) as unknown as Adjustment[];
  return results[0] || null;
}

/**
 * Get adjustment with full details (including related data)
 */
export async function getAdjustmentWithDetails(
  id: string
): Promise<AdjustmentWithDetails | null> {
  const results = await database
    .select({
      adjustment: adjustment,
      settlementPeriodId: settlementPeriod.id,
      settlementPeriodName: settlementPeriod.name,
      settlementPeriodFranchiseeId: settlementPeriod.franchiseeId,
      createdByUserName: user.name,
      createdByUserEmail: user.email,
    })
    .from(adjustment)
    .leftJoin(settlementPeriod, eq(adjustment.settlementPeriodId, settlementPeriod.id))
    .leftJoin(user, eq(adjustment.createdBy, user.id))
    .where(eq(adjustment.id, id))
    .limit(1);

  if (results.length === 0) return null;

  const row = results[0];
  return {
    ...row.adjustment,
    settlementPeriod: row.settlementPeriodId
      ? {
          id: row.settlementPeriodId,
          name: row.settlementPeriodName!,
          franchiseeId: row.settlementPeriodFranchiseeId!,
        }
      : null,
    createdByUser: row.createdByUserName
      ? { name: row.createdByUserName, email: row.createdByUserEmail! }
      : null,
  };
}

/**
 * Create a new adjustment
 * Also creates audit log entry if context provided
 */
export async function createAdjustment(
  data: CreateAdjustmentData,
  auditContext?: AuditContext
): Promise<Adjustment> {
  const [newAdjustment] = (await database
    .insert(adjustment)
    .values(data)
    .returning()) as unknown as Adjustment[];

  // Log to comprehensive audit log if context provided
  if (newAdjustment && auditContext) {
    await logAdjustmentCreate(auditContext, newAdjustment.id, {
      settlementPeriodId: newAdjustment.settlementPeriodId,
      adjustmentType: newAdjustment.adjustmentType,
      amount: newAdjustment.amount,
      reason: newAdjustment.reason,
      description: newAdjustment.description || undefined,
    });
  }

  return newAdjustment;
}

/**
 * Update an existing adjustment
 * Also creates audit log entry if context provided
 */
export async function updateAdjustment(
  id: string,
  data: UpdateAdjustmentData,
  auditContext?: AuditContext,
  reason?: string
): Promise<Adjustment | null> {
  // Get existing adjustment to capture before values
  const existingAdjustment = await getAdjustmentById(id);
  if (!existingAdjustment) return null;

  const beforeData = {
    settlementPeriodId: existingAdjustment.settlementPeriodId,
    adjustmentType: existingAdjustment.adjustmentType,
    amount: existingAdjustment.amount,
    reason: existingAdjustment.reason,
    description: existingAdjustment.description,
    effectiveDate: existingAdjustment.effectiveDate,
  };

  const results = (await database
    .update(adjustment)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(adjustment.id, id))
    .returning()) as unknown as Adjustment[];

  const updatedAdjustment = results[0] || null;

  // Log to comprehensive audit log if context provided
  if (updatedAdjustment && auditContext) {
    const afterData = {
      settlementPeriodId: updatedAdjustment.settlementPeriodId,
      adjustmentType: updatedAdjustment.adjustmentType,
      amount: updatedAdjustment.amount,
      reason: updatedAdjustment.reason,
      description: updatedAdjustment.description,
      effectiveDate: updatedAdjustment.effectiveDate,
    };

    await logAdjustmentUpdate(auditContext, id, beforeData, afterData, reason);
  }

  return updatedAdjustment;
}

/**
 * Delete an adjustment
 * Also creates audit log entry if context provided
 */
export async function deleteAdjustment(
  id: string,
  auditContext?: AuditContext,
  reason?: string
): Promise<boolean> {
  // Get existing adjustment to capture before values
  const existingAdjustment = await getAdjustmentById(id);
  if (!existingAdjustment) return false;

  const result = await database.delete(adjustment).where(eq(adjustment.id, id));
  const deleted = (result.rowCount ?? 0) > 0;

  // Log to comprehensive audit log if context provided
  if (deleted && auditContext) {
    await logAdjustmentDelete(
      auditContext,
      id,
      {
        settlementPeriodId: existingAdjustment.settlementPeriodId,
        adjustmentType: existingAdjustment.adjustmentType,
        amount: existingAdjustment.amount,
        reason: existingAdjustment.reason,
        description: existingAdjustment.description,
      },
      reason
    );
  }

  return deleted;
}

/**
 * Approve an adjustment
 * Also creates audit log entry if context provided
 */
export async function approveAdjustment(
  id: string,
  approvedById: string,
  auditContext?: AuditContext
): Promise<Adjustment | null> {
  // Get existing adjustment to capture before values
  const existingAdjustment = await getAdjustmentById(id);
  if (!existingAdjustment) return null;

  const results = (await database
    .update(adjustment)
    .set({
      approvedAt: new Date(),
      approvedBy: approvedById,
      updatedAt: new Date(),
    })
    .where(eq(adjustment.id, id))
    .returning()) as unknown as Adjustment[];

  const approvedAdjustment = results[0] || null;

  // Log to comprehensive audit log if context provided
  if (approvedAdjustment && auditContext) {
    await logAdjustmentUpdate(
      auditContext,
      id,
      { approvedAt: null, approvedBy: null },
      { approvedAt: approvedAdjustment.approvedAt?.toISOString(), approvedBy: approvedById },
      "Adjustment approved"
    );
  }

  return approvedAdjustment;
}

/**
 * Get adjustments by type
 */
export async function getAdjustmentsByType(
  adjustmentType: AdjustmentType
): Promise<Adjustment[]> {
  return database
    .select()
    .from(adjustment)
    .where(eq(adjustment.adjustmentType, adjustmentType))
    .orderBy(desc(adjustment.createdAt)) as unknown as Promise<Adjustment[]>;
}

/**
 * Get adjustment statistics
 */
export async function getAdjustmentStats(): Promise<{
  total: number;
  byType: Record<string, number>;
  pending: number;
  approved: number;
}> {
  const allAdjustments = await getAdjustments();

  const stats = {
    total: allAdjustments.length,
    byType: {} as Record<string, number>,
    pending: 0,
    approved: 0,
  };

  for (const adj of allAdjustments) {
    // Count by type
    if (adj.adjustmentType) {
      stats.byType[adj.adjustmentType] = (stats.byType[adj.adjustmentType] || 0) + 1;
    }

    // Count by approval status
    if (adj.approvedAt) {
      stats.approved++;
    } else {
      stats.pending++;
    }
  }

  return stats;
}
