import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  getUploadLinksWithPeriodInfo,
  getUploadLinkStatusSummary,
  type UploadLinkEntityType,
} from "@/data-access/uploadLinks";

/**
 * GET /api/upload-links/entity/[entityType]/[entityId] - Get upload links for an entity
 *
 * Returns all upload links for a specific supplier, franchisee, or brand
 * along with period information and status summary.
 */
export async function GET(
  request: NextRequest,
  { params }: { params: Promise<{ entityType: string; entityId: string }> }
) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const { entityType, entityId } = await params;

    // Validate entity type
    if (!["supplier", "franchisee", "brand"].includes(entityType)) {
      return NextResponse.json(
        { error: "Invalid entityType. Must be 'supplier', 'franchisee', or 'brand'" },
        { status: 400 }
      );
    }

    // Get upload links with period info
    const uploadLinks = await getUploadLinksWithPeriodInfo(
      entityType as UploadLinkEntityType,
      entityId
    );

    // Get status summary
    const statusSummary = await getUploadLinkStatusSummary(
      entityType as UploadLinkEntityType,
      entityId
    );

    // Build URLs for each link
    const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "http://localhost:3000";
    const linksWithUrls = uploadLinks.map((link) => ({
      ...link,
      url: `${baseUrl}/upload/${link.token}`,
    }));

    return NextResponse.json({
      uploadLinks: linksWithUrls,
      statusSummary,
    });
  } catch (error) {
    console.error("Error fetching entity upload links:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
