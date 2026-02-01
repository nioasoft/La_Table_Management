import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import { getEmailLogs, getEmailLogStats } from "@/data-access/emailTemplates";
import type { EmailStatus } from "@/db/schema";

/**
 * GET /api/email-logs - Get email logs with optional filters
 *
 * Query params:
 * - status: filter by email status (pending, sent, delivered, failed, bounced)
 * - templateId: filter by template ID
 * - entityType: filter by entity type (supplier, franchisee)
 * - entityId: filter by entity ID
 * - search: search by email address
 * - limit: max records to return (default: 50)
 * - offset: pagination offset (default: 0)
 * - stats: include stats in response (true/false)
 */
export async function GET(request: NextRequest) {
  try {
    // Verify authentication
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status") as EmailStatus | null;
    const templateId = searchParams.get("templateId");
    const entityType = searchParams.get("entityType");
    const entityId = searchParams.get("entityId");
    const limit = parseInt(searchParams.get("limit") || "50", 10);
    const offset = parseInt(searchParams.get("offset") || "0", 10);
    const includeStats = searchParams.get("stats") === "true";

    // Build filter options
    const options: {
      templateId?: string;
      status?: EmailStatus;
      entityType?: string;
      entityId?: string;
      limit?: number;
      offset?: number;
    } = {
      limit,
      offset,
    };

    if (status) {
      options.status = status;
    }
    if (templateId) {
      options.templateId = templateId;
    }
    if (entityType) {
      options.entityType = entityType;
    }
    if (entityId) {
      options.entityId = entityId;
    }

    const logs = await getEmailLogs(options);

    const response: {
      logs: typeof logs;
      stats?: Awaited<ReturnType<typeof getEmailLogStats>>;
    } = { logs };

    if (includeStats) {
      response.stats = await getEmailLogStats();
    }

    return NextResponse.json(response);
  } catch (error) {
    console.error("Error fetching email logs:", error);
    return NextResponse.json(
      {
        error: "Internal server error",
        message: error instanceof Error ? error.message : "Unknown error",
      },
      { status: 500 }
    );
  }
}
