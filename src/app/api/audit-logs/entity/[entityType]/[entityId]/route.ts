import { NextRequest, NextResponse } from "next/server";
import { auth } from "@/utils/auth";
import { getEntityAuditLogs } from "@/data-access/auditLog";
import type { AuditEntityType } from "@/db/schema";

interface RouteContext {
  params: Promise<{ entityType: string; entityId: string }>;
}

// Valid entity types
const VALID_ENTITY_TYPES: AuditEntityType[] = [
  "user",
  "supplier",
  "franchisee",
  "commission",
  "adjustment",
  "settlement_period",
  "brand",
  "document",
];

/**
 * GET /api/audit-logs/entity/[entityType]/[entityId] - Get audit logs for a specific entity
 *
 * Query parameters:
 * - limit: Limit number of results (default: 50, max: 500)
 */
export async function GET(request: NextRequest, context: RouteContext) {
  try {
    const session = await auth.api.getSession({
      headers: request.headers,
    });

    if (!session) {
      return NextResponse.json({ error: "Unauthorized" }, { status: 401 });
    }

    // Check if user is admin or super_user
    const userRole = (session.user as typeof session.user & { role?: string })
      .role;
    if (userRole !== "super_user" && userRole !== "admin") {
      return NextResponse.json(
        { error: "Only Admin or Super User can view audit logs" },
        { status: 403 }
      );
    }

    const { entityType, entityId } = await context.params;

    // Validate entity type
    if (!VALID_ENTITY_TYPES.includes(entityType as AuditEntityType)) {
      return NextResponse.json(
        {
          error: "Invalid entity type",
          validTypes: VALID_ENTITY_TYPES,
        },
        { status: 400 }
      );
    }

    // Get limit from query params
    const searchParams = request.nextUrl.searchParams;
    const limitParam = searchParams.get("limit");
    const limit = limitParam ? Math.min(parseInt(limitParam), 500) : 50;

    // Fetch audit logs for the entity
    const auditLogs = await getEntityAuditLogs(
      entityType as AuditEntityType,
      entityId,
      limit
    );

    return NextResponse.json({
      auditLogs,
      entityType,
      entityId,
      count: auditLogs.length,
    });
  } catch (error) {
    console.error("Error fetching entity audit logs:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
