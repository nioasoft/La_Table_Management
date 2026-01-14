import { database } from "@/db";
import {
  settlementPeriod,
  franchisee,
  user,
  type SettlementPeriod,
  type CreateSettlementPeriodData,
  type UpdateSettlementPeriodData,
  type SettlementStatus,
  type SettlementPeriodType,
} from "@/db/schema";
import { eq, desc, and, gte, lte, isNull } from "drizzle-orm";
import { getPeriodByKey } from "@/lib/settlement-periods";
import {
  logSettlementStatusChange,
  logSettlementApproval,
  type AuditContext,
} from "./auditLog";

// ============================================================================
// SETTLEMENT PERIOD STATUS LIFECYCLE
// ============================================================================

/**
 * Valid status transitions for settlement period lifecycle
 * The settlement period follows this lifecycle:
 * open -> processing -> pending_approval -> approved -> invoiced
 *
 * Transitions:
 * - open: Initial state when period is created
 * - processing: Period is being worked on (calculations, data collection)
 * - pending_approval: Ready for review and approval
 * - approved: Approved by authorized user
 * - invoiced: Invoice has been generated/sent
 * - cancelled: Period has been cancelled (can happen from most states)
 *
 * Legacy states (draft, pending, completed) are still supported for backward compatibility
 */
export const SETTLEMENT_STATUS_TRANSITIONS: Record<SettlementStatus, SettlementStatus[]> = {
  // New lifecycle statuses
  open: ["processing", "cancelled"],
  processing: ["pending_approval", "open", "cancelled"],
  pending_approval: ["approved", "processing", "cancelled"],
  approved: ["invoiced", "pending_approval", "cancelled"],
  invoiced: [], // Terminal state - no transitions allowed
  // Legacy statuses (for backward compatibility)
  draft: ["pending", "open", "cancelled"],
  pending: ["approved", "pending_approval", "draft", "cancelled"],
  completed: ["invoiced"], // Map to new terminal state
  cancelled: [], // Terminal state - no transitions allowed
};

/**
 * Check if a status transition is valid
 */
export function isValidStatusTransition(
  currentStatus: SettlementStatus,
  newStatus: SettlementStatus
): boolean {
  const allowedTransitions = SETTLEMENT_STATUS_TRANSITIONS[currentStatus];
  return allowedTransitions?.includes(newStatus) ?? false;
}

/**
 * Get allowed next statuses for a given status
 */
export function getAllowedNextStatuses(currentStatus: SettlementStatus): SettlementStatus[] {
  return SETTLEMENT_STATUS_TRANSITIONS[currentStatus] ?? [];
}

// ============================================================================
// SETTLEMENT TYPES
// ============================================================================

/**
 * Extended settlement type with related data
 */
export type SettlementWithDetails = SettlementPeriod & {
  franchisee?: {
    id: string;
    name: string;
    code: string;
  } | null;
  createdByUser?: { name: string; email: string } | null;
  approvedByUser?: { name: string; email: string } | null;
};

// ============================================================================
// CORE SETTLEMENT FUNCTIONS
// ============================================================================

/**
 * Get all settlement periods
 */
export async function getSettlementPeriods(): Promise<SettlementPeriod[]> {
  return database
    .select()
    .from(settlementPeriod)
    .orderBy(desc(settlementPeriod.createdAt)) as unknown as Promise<SettlementPeriod[]>;
}

/**
 * Get settlement periods by franchisee ID
 */
export async function getSettlementPeriodsByFranchisee(
  franchiseeId: string
): Promise<SettlementPeriod[]> {
  return database
    .select()
    .from(settlementPeriod)
    .where(eq(settlementPeriod.franchiseeId, franchiseeId))
    .orderBy(desc(settlementPeriod.periodStartDate)) as unknown as Promise<SettlementPeriod[]>;
}

/**
 * Get settlement periods by status
 */
export async function getSettlementPeriodsByStatus(
  status: SettlementStatus
): Promise<SettlementPeriod[]> {
  return database
    .select()
    .from(settlementPeriod)
    .where(eq(settlementPeriod.status, status))
    .orderBy(desc(settlementPeriod.periodStartDate)) as unknown as Promise<SettlementPeriod[]>;
}

/**
 * Get a single settlement period by ID
 */
export async function getSettlementPeriodById(
  id: string
): Promise<SettlementPeriod | null> {
  const results = (await database
    .select()
    .from(settlementPeriod)
    .where(eq(settlementPeriod.id, id))
    .limit(1)) as unknown as SettlementPeriod[];
  return results[0] || null;
}

/**
 * Get settlement period with full details including approver info
 */
export async function getSettlementPeriodWithDetails(
  id: string
): Promise<SettlementWithDetails | null> {
  // Create aliases for the user table to join twice
  const createdByUser = database
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
    })
    .from(user)
    .as("created_by_user");

  const approvedByUser = database
    .select({
      id: user.id,
      name: user.name,
      email: user.email,
    })
    .from(user)
    .as("approved_by_user");

  const results = await database
    .select({
      settlementPeriod: settlementPeriod,
      franchiseeId: franchisee.id,
      franchiseeName: franchisee.name,
      franchiseeCode: franchisee.code,
      createdByUserName: createdByUser.name,
      createdByUserEmail: createdByUser.email,
      approvedByUserName: approvedByUser.name,
      approvedByUserEmail: approvedByUser.email,
    })
    .from(settlementPeriod)
    .leftJoin(franchisee, eq(settlementPeriod.franchiseeId, franchisee.id))
    .leftJoin(createdByUser, eq(settlementPeriod.createdBy, createdByUser.id))
    .leftJoin(approvedByUser, eq(settlementPeriod.approvedBy, approvedByUser.id))
    .where(eq(settlementPeriod.id, id))
    .limit(1);

  if (results.length === 0) return null;

  const row = results[0];
  return {
    ...row.settlementPeriod,
    franchisee: row.franchiseeId
      ? {
          id: row.franchiseeId,
          name: row.franchiseeName!,
          code: row.franchiseeCode!,
        }
      : null,
    createdByUser: row.createdByUserName
      ? { name: row.createdByUserName, email: row.createdByUserEmail! }
      : null,
    approvedByUser: row.approvedByUserName
      ? { name: row.approvedByUserName, email: row.approvedByUserEmail! }
      : null,
  };
}

/**
 * Create a new settlement period
 */
export async function createSettlementPeriod(
  data: CreateSettlementPeriodData
): Promise<SettlementPeriod> {
  const [newSettlement] = (await database
    .insert(settlementPeriod)
    .values(data)
    .returning()) as unknown as SettlementPeriod[];
  return newSettlement;
}

/**
 * Update an existing settlement period
 * Also creates audit log entry for status changes if context provided
 */
export async function updateSettlementPeriod(
  id: string,
  data: UpdateSettlementPeriodData,
  auditContext?: AuditContext,
  reason?: string
): Promise<SettlementPeriod | null> {
  // Get existing settlement to compare status
  const existingSettlement = await getSettlementPeriodById(id);
  if (!existingSettlement) return null;

  const oldStatus = existingSettlement.status;
  const newStatus = data.status;

  const isStatusChanging = newStatus !== undefined && oldStatus !== newStatus;

  const results = (await database
    .update(settlementPeriod)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(settlementPeriod.id, id))
    .returning()) as unknown as SettlementPeriod[];

  const updatedSettlement = results[0] || null;

  // Log status change to comprehensive audit log if context provided
  if (updatedSettlement && isStatusChanging && newStatus !== undefined && auditContext) {
    await logSettlementStatusChange(
      auditContext,
      id,
      existingSettlement.name,
      oldStatus,
      newStatus,
      reason
    );
  }

  return updatedSettlement;
}

/**
 * Approve a settlement period
 * Also creates audit log entry if context provided
 */
export async function approveSettlementPeriod(
  id: string,
  approvedById: string,
  auditContext?: AuditContext
): Promise<SettlementPeriod | null> {
  // Get existing settlement to capture before values
  const existingSettlement = await getSettlementPeriodById(id);
  if (!existingSettlement) return null;

  const previousStatus = existingSettlement.status;

  const results = (await database
    .update(settlementPeriod)
    .set({
      status: "approved",
      approvedAt: new Date(),
      approvedBy: approvedById,
      updatedAt: new Date(),
    })
    .where(eq(settlementPeriod.id, id))
    .returning()) as unknown as SettlementPeriod[];

  const approvedSettlement = results[0] || null;

  // Log to comprehensive audit log if context provided
  if (approvedSettlement && auditContext) {
    await logSettlementApproval(
      auditContext,
      id,
      existingSettlement.name,
      previousStatus
    );
  }

  return approvedSettlement;
}

/**
 * Update settlement status
 * Also creates audit log entry if context provided
 */
export async function updateSettlementStatus(
  id: string,
  status: SettlementStatus,
  auditContext?: AuditContext,
  reason?: string
): Promise<SettlementPeriod | null> {
  return updateSettlementPeriod(id, { status }, auditContext, reason);
}

/**
 * Delete a settlement period
 */
export async function deleteSettlementPeriod(id: string): Promise<boolean> {
  const result = await database
    .delete(settlementPeriod)
    .where(eq(settlementPeriod.id, id));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Get settlement periods within date range
 */
export async function getSettlementPeriodsByDateRange(
  startDate: string,
  endDate: string
): Promise<SettlementPeriod[]> {
  return database
    .select()
    .from(settlementPeriod)
    .where(
      and(
        gte(settlementPeriod.periodStartDate, startDate),
        lte(settlementPeriod.periodEndDate, endDate)
      )
    )
    .orderBy(desc(settlementPeriod.periodStartDate)) as unknown as Promise<SettlementPeriod[]>;
}

/**
 * Get settlement period statistics
 */
export async function getSettlementStats(): Promise<{
  total: number;
  byStatus: Record<string, number>;
  byPeriodType: Record<string, number>;
}> {
  const allSettlements = await getSettlementPeriods();

  const stats = {
    total: allSettlements.length,
    byStatus: {} as Record<string, number>,
    byPeriodType: {} as Record<string, number>,
  };

  for (const settlement of allSettlements) {
    if (settlement.status) {
      stats.byStatus[settlement.status] = (stats.byStatus[settlement.status] || 0) + 1;
    }
    if (settlement.periodType) {
      stats.byPeriodType[settlement.periodType] = (stats.byPeriodType[settlement.periodType] || 0) + 1;
    }
  }

  return stats;
}

// ============================================================================
// PERIOD TYPE FUNCTIONS
// ============================================================================

/**
 * Get settlement periods by period type
 */
export async function getSettlementPeriodsByType(
  periodType: SettlementPeriodType
): Promise<SettlementPeriod[]> {
  return database
    .select()
    .from(settlementPeriod)
    .where(eq(settlementPeriod.periodType, periodType))
    .orderBy(desc(settlementPeriod.periodStartDate)) as unknown as Promise<SettlementPeriod[]>;
}

/**
 * Get open settlement periods (periods currently accepting transactions)
 */
export async function getOpenSettlementPeriods(): Promise<SettlementPeriod[]> {
  return database
    .select()
    .from(settlementPeriod)
    .where(eq(settlementPeriod.status, "open"))
    .orderBy(desc(settlementPeriod.periodStartDate)) as unknown as Promise<SettlementPeriod[]>;
}

/**
 * Get settlement periods pending approval
 */
export async function getPendingApprovalSettlements(): Promise<SettlementPeriod[]> {
  return database
    .select()
    .from(settlementPeriod)
    .where(eq(settlementPeriod.status, "pending_approval"))
    .orderBy(desc(settlementPeriod.periodStartDate)) as unknown as Promise<SettlementPeriod[]>;
}

// ============================================================================
// LIFECYCLE MANAGEMENT FUNCTIONS
// ============================================================================

/**
 * Calculate period dates based on period type
 * Returns the start and end dates for a period given a reference date
 */
export function calculatePeriodDates(
  periodType: SettlementPeriodType,
  referenceDate: Date = new Date()
): { startDate: Date; endDate: Date } {
  const year = referenceDate.getFullYear();
  const month = referenceDate.getMonth();

  switch (periodType) {
    case "monthly":
      return {
        startDate: new Date(year, month, 1),
        endDate: new Date(year, month + 1, 0), // Last day of month
      };
    case "quarterly":
      const quarterStart = Math.floor(month / 3) * 3;
      return {
        startDate: new Date(year, quarterStart, 1),
        endDate: new Date(year, quarterStart + 3, 0),
      };
    case "semi_annual":
      const halfStart = month < 6 ? 0 : 6;
      return {
        startDate: new Date(year, halfStart, 1),
        endDate: new Date(year, halfStart + 6, 0),
      };
    case "annual":
      return {
        startDate: new Date(year, 0, 1),
        endDate: new Date(year, 11, 31),
      };
    default:
      // Default to monthly
      return {
        startDate: new Date(year, month, 1),
        endDate: new Date(year, month + 1, 0),
      };
  }
}

/**
 * Generate a name for a settlement period based on its type and dates
 */
export function generatePeriodName(
  periodType: SettlementPeriodType,
  startDate: Date
): string {
  const year = startDate.getFullYear();
  const month = startDate.getMonth();

  switch (periodType) {
    case "monthly":
      const monthNames = [
        "January", "February", "March", "April", "May", "June",
        "July", "August", "September", "October", "November", "December"
      ];
      return `${monthNames[month]} ${year}`;
    case "quarterly":
      const quarter = Math.floor(month / 3) + 1;
      return `Q${quarter} ${year}`;
    case "semi_annual":
      const half = month < 6 ? "H1" : "H2";
      return `${half} ${year}`;
    case "annual":
      return `FY ${year}`;
    default:
      return `Period ${year}-${(month + 1).toString().padStart(2, "0")}`;
  }
}

/**
 * Create a new settlement period with automatic date calculation
 */
export async function createSettlementPeriodWithType(
  franchiseeId: string,
  periodType: SettlementPeriodType,
  referenceDate: Date = new Date(),
  createdBy?: string,
  additionalData?: Partial<CreateSettlementPeriodData>
): Promise<SettlementPeriod> {
  const { startDate, endDate } = calculatePeriodDates(periodType, referenceDate);
  const name = generatePeriodName(periodType, startDate);

  const data: CreateSettlementPeriodData = {
    id: crypto.randomUUID(),
    name,
    franchiseeId,
    periodType,
    periodStartDate: startDate.toISOString().split("T")[0],
    periodEndDate: endDate.toISOString().split("T")[0],
    status: "open",
    createdBy: createdBy || null,
    ...additionalData,
  };

  return createSettlementPeriod(data);
}

/**
 * Transition settlement period status with validation
 * Returns null if transition is not valid, otherwise returns updated settlement
 */
export async function transitionSettlementStatus(
  id: string,
  newStatus: SettlementStatus,
  auditContext?: AuditContext,
  reason?: string
): Promise<{ success: boolean; settlement?: SettlementPeriod; error?: string }> {
  const existingSettlement = await getSettlementPeriodById(id);

  if (!existingSettlement) {
    return { success: false, error: "Settlement period not found" };
  }

  const currentStatus = existingSettlement.status;

  // Validate transition
  if (!isValidStatusTransition(currentStatus, newStatus)) {
    const allowedTransitions = getAllowedNextStatuses(currentStatus);
    return {
      success: false,
      error: `Invalid status transition from '${currentStatus}' to '${newStatus}'. Allowed transitions: ${allowedTransitions.join(", ") || "none"}`,
    };
  }

  // Perform the update
  const updatedSettlement = await updateSettlementPeriod(
    id,
    { status: newStatus },
    auditContext,
    reason
  );

  if (!updatedSettlement) {
    return { success: false, error: "Failed to update settlement period" };
  }

  return { success: true, settlement: updatedSettlement };
}

/**
 * Start processing a settlement period
 */
export async function startProcessing(
  id: string,
  auditContext?: AuditContext
): Promise<{ success: boolean; settlement?: SettlementPeriod; error?: string }> {
  return transitionSettlementStatus(id, "processing", auditContext, "Started processing");
}

/**
 * Submit settlement period for approval
 */
export async function submitForApproval(
  id: string,
  auditContext?: AuditContext
): Promise<{ success: boolean; settlement?: SettlementPeriod; error?: string }> {
  return transitionSettlementStatus(id, "pending_approval", auditContext, "Submitted for approval");
}

/**
 * Approve settlement period with proper validation
 */
export async function approveSettlementWithValidation(
  id: string,
  approvedById: string,
  auditContext?: AuditContext
): Promise<{ success: boolean; settlement?: SettlementPeriod; error?: string }> {
  const existingSettlement = await getSettlementPeriodById(id);

  if (!existingSettlement) {
    return { success: false, error: "Settlement period not found" };
  }

  const currentStatus = existingSettlement.status;

  // Validate transition
  if (!isValidStatusTransition(currentStatus, "approved")) {
    return {
      success: false,
      error: `Cannot approve settlement from status '${currentStatus}'. Settlement must be in 'pending_approval' status.`,
    };
  }

  const approvedSettlement = await approveSettlementPeriod(id, approvedById, auditContext);

  if (!approvedSettlement) {
    return { success: false, error: "Failed to approve settlement period" };
  }

  return { success: true, settlement: approvedSettlement };
}

/**
 * Mark settlement period as invoiced
 */
export async function markAsInvoiced(
  id: string,
  auditContext?: AuditContext
): Promise<{ success: boolean; settlement?: SettlementPeriod; error?: string }> {
  return transitionSettlementStatus(id, "invoiced", auditContext, "Invoice generated");
}

/**
 * Cancel a settlement period
 */
export async function cancelSettlementPeriod(
  id: string,
  reason: string,
  auditContext?: AuditContext
): Promise<{ success: boolean; settlement?: SettlementPeriod; error?: string }> {
  return transitionSettlementStatus(id, "cancelled", auditContext, reason);
}

/**
 * Reopen a settlement period (move back to processing for corrections)
 */
export async function reopenSettlementPeriod(
  id: string,
  reason: string,
  auditContext?: AuditContext
): Promise<{ success: boolean; settlement?: SettlementPeriod; error?: string }> {
  const existingSettlement = await getSettlementPeriodById(id);

  if (!existingSettlement) {
    return { success: false, error: "Settlement period not found" };
  }

  const currentStatus = existingSettlement.status;

  // Can only reopen from pending_approval or approved
  if (currentStatus !== "pending_approval" && currentStatus !== "approved") {
    return {
      success: false,
      error: `Cannot reopen settlement from status '${currentStatus}'. Only 'pending_approval' or 'approved' settlements can be reopened.`,
    };
  }

  return transitionSettlementStatus(id, "processing", auditContext, reason);
}

// ============================================================================
// PERIOD KEY FUNCTIONS (for settlement workflow)
// ============================================================================

/**
 * Get an existing settlement period by period key (e.g., "2025-Q4", "2025-01")
 * This finds a settlement_period record that matches the period dates and has no franchisee
 * (period-based settlements vs per-franchisee settlements)
 */
export async function getSettlementPeriodByPeriodKey(
  periodKey: string
): Promise<SettlementPeriod | null> {
  const periodInfo = getPeriodByKey(periodKey);
  if (!periodInfo) return null;

  const periodStartDate = periodInfo.startDate.toISOString().split("T")[0];
  const periodEndDate = periodInfo.endDate.toISOString().split("T")[0];

  const results = await database
    .select()
    .from(settlementPeriod)
    .where(
      and(
        eq(settlementPeriod.periodStartDate, periodStartDate),
        eq(settlementPeriod.periodEndDate, periodEndDate),
        isNull(settlementPeriod.franchiseeId),
        eq(settlementPeriod.periodType, periodInfo.type)
      )
    )
    .limit(1) as unknown as SettlementPeriod[];

  return results[0] || null;
}

/**
 * Get or create a settlement period by period key
 * Creates a new period-based settlement (franchiseeId = null) if one doesn't exist
 */
export async function getOrCreateSettlementPeriodByPeriodKey(
  periodKey: string,
  createdBy?: string
): Promise<{ settlementPeriod: SettlementPeriod; created: boolean } | null> {
  const periodInfo = getPeriodByKey(periodKey);
  if (!periodInfo) return null;

  // Try to find existing
  const existing = await getSettlementPeriodByPeriodKey(periodKey);
  if (existing) {
    return { settlementPeriod: existing, created: false };
  }

  // Create new period-based settlement
  const periodStartDate = periodInfo.startDate.toISOString().split("T")[0];
  const periodEndDate = periodInfo.endDate.toISOString().split("T")[0];

  const newSettlement = await createSettlementPeriod({
    id: crypto.randomUUID(),
    name: periodInfo.nameHe,
    franchiseeId: null, // Period-based, not per-franchisee
    periodType: periodInfo.type,
    periodStartDate,
    periodEndDate,
    status: "open",
    createdBy: createdBy || null,
    metadata: { periodKey },
  });

  return { settlementPeriod: newSettlement, created: true };
}
