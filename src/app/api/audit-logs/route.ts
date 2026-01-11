import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import {
  getAuditLogs,
  getAuditLogStats,
  type AuditLogQueryOptions,
} from "@/data-access/auditLog";
import type { AuditAction, AuditEntityType } from "@/db/schema";

/**
 * GET /api/audit-logs - Get audit logs with filtering options (Super User only)
 *
 * Query parameters:
 * - entityType: Filter by entity type (user, supplier, franchisee, commission, adjustment, settlement_period, brand, document)
 * - entityId: Filter by specific entity ID
 * - userId: Filter by user who performed the action
 * - action: Filter by single action type
 * - actions: Filter by multiple action types (comma-separated)
 * - startDate: Filter by start date (ISO format)
 * - endDate: Filter by end date (ISO format)
 * - limit: Limit number of results (default: 100, max: 1000)
 * - offset: Offset for pagination
 * - stats: Include statistics if "true"
 */
export async function GET(request: NextRequest) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Only super_user can view audit logs
    const userRole = (session.user as typeof session.user & { role?: string })
      .role;
    if (userRole !== "super_user") {
      return NextResponse.json(
        { error: "Only Super User can view audit logs" },
        { status: 403 }
      );
    }

    const searchParams = request.nextUrl.searchParams;

    // Build query options from search params
    const queryOptions: AuditLogQueryOptions = {};

    // Entity type filter
    const entityType = searchParams.get("entityType");
    if (entityType) {
      queryOptions.entityType = entityType as AuditEntityType;
    }

    // Entity ID filter
    const entityId = searchParams.get("entityId");
    if (entityId) {
      queryOptions.entityId = entityId;
    }

    // User ID filter
    const userId = searchParams.get("userId");
    if (userId) {
      queryOptions.userId = userId;
    }

    // Single action filter
    const action = searchParams.get("action");
    if (action) {
      queryOptions.action = action as AuditAction;
    }

    // Multiple actions filter
    const actionsParam = searchParams.get("actions");
    if (actionsParam) {
      queryOptions.actions = actionsParam.split(",") as AuditAction[];
    }

    // Date range filters
    const startDate = searchParams.get("startDate");
    if (startDate) {
      queryOptions.startDate = new Date(startDate);
    }

    const endDate = searchParams.get("endDate");
    if (endDate) {
      queryOptions.endDate = new Date(endDate);
    }

    // Pagination
    const limit = searchParams.get("limit");
    queryOptions.limit = limit ? Math.min(parseInt(limit), 1000) : 100;

    const offset = searchParams.get("offset");
    if (offset) {
      queryOptions.offset = parseInt(offset);
    }

    // Fetch audit logs
    const auditLogs = await getAuditLogs(queryOptions);

    // Get stats if requested
    const includeStats = searchParams.get("stats") === "true";
    const stats = includeStats ? await getAuditLogStats() : null;

    return NextResponse.json({
      auditLogs,
      stats,
      pagination: {
        limit: queryOptions.limit,
        offset: queryOptions.offset || 0,
        count: auditLogs.length,
      },
    });
  } catch (error) {
    console.error("Error fetching audit logs:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
