import { database } from "@/db";
import {
  auditLog,
  user,
  type AuditLog,
  type CreateAuditLogData,
  type AuditAction,
  type AuditEntityType,
} from "@/db/schema";
import { eq, desc, and, gte, lte, sql, inArray } from "drizzle-orm";

// ============================================================================
// AUDIT LOG TYPES
// ============================================================================

/**
 * Extended audit log entry with user information
 */
export type AuditLogWithUser = AuditLog & {
  performedByUser?: { name: string; email: string } | null;
};

/**
 * Context information for creating audit logs
 */
export interface AuditContext {
  userId: string;
  userName: string;
  userEmail: string;
  ipAddress?: string;
  userAgent?: string;
}

/**
 * Options for querying audit logs
 */
export interface AuditLogQueryOptions {
  entityType?: AuditEntityType;
  entityId?: string;
  userId?: string;
  action?: AuditAction;
  actions?: AuditAction[];
  startDate?: Date;
  endDate?: Date;
  limit?: number;
  offset?: number;
}

// ============================================================================
// CORE AUDIT LOG FUNCTIONS
// ============================================================================

/**
 * Create a new audit log entry
 */
export async function createAuditLogEntry(
  data: CreateAuditLogData
): Promise<AuditLog> {
  const [entry] = (await database
    .insert(auditLog)
    .values(data)
    .returning()) as unknown as AuditLog[];
  return entry;
}

/**
 * Helper function to create audit log with context
 */
export async function logAuditEvent(
  context: AuditContext,
  action: AuditAction,
  entityType: AuditEntityType,
  entityId: string,
  options: {
    entityName?: string;
    beforeValue?: Record<string, unknown> | null;
    afterValue?: Record<string, unknown> | null;
    reason?: string;
    notes?: string;
    metadata?: Record<string, unknown>;
  } = {}
): Promise<AuditLog> {
  return createAuditLogEntry({
    id: crypto.randomUUID(),
    userId: context.userId,
    userName: context.userName,
    userEmail: context.userEmail,
    timestamp: new Date(),
    action,
    entityType,
    entityId,
    entityName: options.entityName,
    beforeValue: options.beforeValue,
    afterValue: options.afterValue,
    reason: options.reason,
    notes: options.notes,
    ipAddress: context.ipAddress,
    userAgent: context.userAgent,
    metadata: options.metadata,
  });
}

/**
 * Get audit logs with filtering options
 */
export async function getAuditLogs(
  options: AuditLogQueryOptions = {}
): Promise<AuditLogWithUser[]> {
  const conditions = [];

  if (options.entityType) {
    conditions.push(eq(auditLog.entityType, options.entityType));
  }

  if (options.entityId) {
    conditions.push(eq(auditLog.entityId, options.entityId));
  }

  if (options.userId) {
    conditions.push(eq(auditLog.userId, options.userId));
  }

  if (options.action) {
    conditions.push(eq(auditLog.action, options.action));
  }

  if (options.actions && options.actions.length > 0) {
    conditions.push(inArray(auditLog.action, options.actions));
  }

  if (options.startDate) {
    conditions.push(gte(auditLog.timestamp, options.startDate));
  }

  if (options.endDate) {
    conditions.push(lte(auditLog.timestamp, options.endDate));
  }

  const query = database
    .select({
      id: auditLog.id,
      userId: auditLog.userId,
      userName: auditLog.userName,
      userEmail: auditLog.userEmail,
      timestamp: auditLog.timestamp,
      action: auditLog.action,
      entityType: auditLog.entityType,
      entityId: auditLog.entityId,
      entityName: auditLog.entityName,
      beforeValue: auditLog.beforeValue,
      afterValue: auditLog.afterValue,
      reason: auditLog.reason,
      notes: auditLog.notes,
      ipAddress: auditLog.ipAddress,
      userAgent: auditLog.userAgent,
      metadata: auditLog.metadata,
      createdAt: auditLog.createdAt,
      performedByUserName: user.name,
      performedByUserEmail: user.email,
    })
    .from(auditLog)
    .leftJoin(user, eq(auditLog.userId, user.id))
    .orderBy(desc(auditLog.timestamp));

  if (conditions.length > 0) {
    query.where(and(...conditions));
  }

  if (options.limit) {
    query.limit(options.limit);
  }

  if (options.offset) {
    query.offset(options.offset);
  }

  const results = await query;

  return results.map((row) => ({
    id: row.id,
    userId: row.userId,
    userName: row.userName,
    userEmail: row.userEmail,
    timestamp: row.timestamp,
    action: row.action,
    entityType: row.entityType,
    entityId: row.entityId,
    entityName: row.entityName,
    beforeValue: row.beforeValue,
    afterValue: row.afterValue,
    reason: row.reason,
    notes: row.notes,
    ipAddress: row.ipAddress,
    userAgent: row.userAgent,
    metadata: row.metadata,
    createdAt: row.createdAt,
    performedByUser: row.performedByUserName
      ? { name: row.performedByUserName, email: row.performedByUserEmail! }
      : null,
  }));
}

/**
 * Get audit logs for a specific entity
 */
export async function getEntityAuditLogs(
  entityType: AuditEntityType,
  entityId: string,
  limit: number = 50
): Promise<AuditLogWithUser[]> {
  return getAuditLogs({ entityType, entityId, limit });
}

/**
 * Get audit logs by user
 */
export async function getUserAuditLogs(
  userId: string,
  limit: number = 50
): Promise<AuditLogWithUser[]> {
  return getAuditLogs({ userId, limit });
}

/**
 * Get recent audit logs
 */
export async function getRecentAuditLogs(
  limit: number = 100
): Promise<AuditLogWithUser[]> {
  return getAuditLogs({ limit });
}

/**
 * Get audit logs count by entity type
 */
export async function getAuditLogStats(): Promise<{
  total: number;
  byEntityType: Record<string, number>;
  byAction: Record<string, number>;
}> {
  const allLogs = await getAuditLogs({ limit: 10000 });

  const stats = {
    total: allLogs.length,
    byEntityType: {} as Record<string, number>,
    byAction: {} as Record<string, number>,
  };

  for (const log of allLogs) {
    // Count by entity type
    if (log.entityType) {
      stats.byEntityType[log.entityType] = (stats.byEntityType[log.entityType] || 0) + 1;
    }

    // Count by action
    if (log.action) {
      stats.byAction[log.action] = (stats.byAction[log.action] || 0) + 1;
    }
  }

  return stats;
}

// ============================================================================
// SPECIALIZED AUDIT LOG FUNCTIONS FOR SPECIFIC ACTIONS
// ============================================================================

/**
 * Log a commission rate change
 */
export async function logCommissionChange(
  context: AuditContext,
  supplierId: string,
  supplierName: string,
  previousRate: string | null,
  newRate: string,
  reason?: string,
  notes?: string
): Promise<AuditLog> {
  return logAuditEvent(context, "commission_change", "supplier", supplierId, {
    entityName: supplierName,
    beforeValue: { commissionRate: previousRate },
    afterValue: { commissionRate: newRate },
    reason,
    notes,
  });
}

/**
 * Log a franchisee status change
 */
export async function logFranchiseeStatusChange(
  context: AuditContext,
  franchiseeId: string,
  franchiseeName: string,
  previousStatus: string | null,
  newStatus: string,
  reason?: string,
  notes?: string
): Promise<AuditLog> {
  return logAuditEvent(context, "status_change", "franchisee", franchiseeId, {
    entityName: franchiseeName,
    beforeValue: { status: previousStatus },
    afterValue: { status: newStatus },
    reason,
    notes,
  });
}

/**
 * Log a user approval
 */
export async function logUserApproval(
  context: AuditContext,
  approvedUserId: string,
  approvedUserName: string,
  approvedUserEmail: string,
  assignedRole: string,
  previousStatus: string
): Promise<AuditLog> {
  return logAuditEvent(context, "user_approve", "user", approvedUserId, {
    entityName: approvedUserName,
    beforeValue: { status: previousStatus, role: null },
    afterValue: { status: "active", role: assignedRole },
    metadata: { approvedUserEmail },
  });
}

/**
 * Log a user suspension
 */
export async function logUserSuspension(
  context: AuditContext,
  suspendedUserId: string,
  suspendedUserName: string,
  previousStatus: string,
  reason?: string
): Promise<AuditLog> {
  return logAuditEvent(context, "user_suspend", "user", suspendedUserId, {
    entityName: suspendedUserName,
    beforeValue: { status: previousStatus },
    afterValue: { status: "suspended" },
    reason,
  });
}

/**
 * Log a user reactivation
 */
export async function logUserReactivation(
  context: AuditContext,
  reactivatedUserId: string,
  reactivatedUserName: string
): Promise<AuditLog> {
  return logAuditEvent(context, "user_reactivate", "user", reactivatedUserId, {
    entityName: reactivatedUserName,
    beforeValue: { status: "suspended" },
    afterValue: { status: "active" },
  });
}

/**
 * Log an adjustment creation
 */
export async function logAdjustmentCreate(
  context: AuditContext,
  adjustmentId: string,
  adjustmentData: {
    settlementPeriodId: string;
    adjustmentType: string;
    amount: string;
    reason: string;
    description?: string;
  }
): Promise<AuditLog> {
  return logAuditEvent(context, "adjustment_create", "adjustment", adjustmentId, {
    entityName: `${adjustmentData.adjustmentType} - ${adjustmentData.amount}`,
    afterValue: adjustmentData,
    reason: adjustmentData.reason,
  });
}

/**
 * Log an adjustment update
 */
export async function logAdjustmentUpdate(
  context: AuditContext,
  adjustmentId: string,
  beforeData: Record<string, unknown>,
  afterData: Record<string, unknown>,
  reason?: string
): Promise<AuditLog> {
  return logAuditEvent(context, "adjustment_update", "adjustment", adjustmentId, {
    beforeValue: beforeData,
    afterValue: afterData,
    reason,
  });
}

/**
 * Log an adjustment deletion
 */
export async function logAdjustmentDelete(
  context: AuditContext,
  adjustmentId: string,
  adjustmentData: Record<string, unknown>,
  reason?: string
): Promise<AuditLog> {
  return logAuditEvent(context, "adjustment_delete", "adjustment", adjustmentId, {
    beforeValue: adjustmentData,
    afterValue: null,
    reason,
  });
}

/**
 * Log a settlement status change
 */
export async function logSettlementStatusChange(
  context: AuditContext,
  settlementId: string,
  settlementName: string,
  previousStatus: string,
  newStatus: string,
  reason?: string
): Promise<AuditLog> {
  return logAuditEvent(context, "settlement_status_change", "settlement_period", settlementId, {
    entityName: settlementName,
    beforeValue: { status: previousStatus },
    afterValue: { status: newStatus },
    reason,
  });
}

/**
 * Log a settlement approval
 */
export async function logSettlementApproval(
  context: AuditContext,
  settlementId: string,
  settlementName: string,
  previousStatus: string
): Promise<AuditLog> {
  return logAuditEvent(context, "settlement_approve", "settlement_period", settlementId, {
    entityName: settlementName,
    beforeValue: { status: previousStatus, approvedAt: null, approvedBy: null },
    afterValue: { status: "approved", approvedAt: new Date().toISOString(), approvedBy: context.userId },
  });
}

/**
 * Log a permission change
 */
export async function logPermissionChange(
  context: AuditContext,
  targetUserId: string,
  targetUserName: string,
  beforePermissions: Record<string, unknown> | null,
  afterPermissions: Record<string, unknown>,
  reason?: string
): Promise<AuditLog> {
  return logAuditEvent(context, "permission_change", "user", targetUserId, {
    entityName: targetUserName,
    beforeValue: { permissions: beforePermissions },
    afterValue: { permissions: afterPermissions },
    reason,
  });
}

/**
 * Log a commission status change (pending -> calculated -> approved -> paid)
 */
export async function logCommissionStatusChange(
  context: AuditContext,
  commissionId: string,
  supplierName: string,
  franchiseeName: string,
  previousStatus: string,
  newStatus: string,
  amount?: string,
  reason?: string
): Promise<AuditLog> {
  return logAuditEvent(context, "status_change", "commission", commissionId, {
    entityName: `${supplierName} - ${franchiseeName}`,
    beforeValue: { status: previousStatus },
    afterValue: { status: newStatus },
    reason,
    metadata: { amount, supplierName, franchiseeName },
  });
}

/**
 * Create context from session information
 */
export function createAuditContext(
  session: { user: { id: string; name: string; email: string } },
  request?: Request
): AuditContext {
  const context: AuditContext = {
    userId: session.user.id,
    userName: session.user.name,
    userEmail: session.user.email,
  };

  if (request) {
    // Extract IP address from headers
    const forwarded = request.headers.get("x-forwarded-for");
    if (forwarded) {
      context.ipAddress = forwarded.split(",")[0].trim();
    } else {
      const realIp = request.headers.get("x-real-ip");
      if (realIp) {
        context.ipAddress = realIp;
      }
    }

    // Extract user agent
    const userAgent = request.headers.get("user-agent");
    if (userAgent) {
      context.userAgent = userAgent;
    }
  }

  return context;
}
