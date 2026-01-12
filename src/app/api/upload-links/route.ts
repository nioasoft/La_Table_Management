import { NextRequest, NextResponse } from "next/server";
import {
  requireAdminOrSuperUser,
  isAuthError,
} from "@/lib/api-middleware";
import {
  generateSecureUploadLink,
  generateSupplierUploadLink,
  generateFranchiseeUploadLink,
  getAllUploadLinks,
  type UploadLinkEntityType,
  type UploadLinkPeriodInfo,
} from "@/data-access/uploadLinks";
import type { UploadLinkStatus } from "@/db/schema";

/**
 * GET /api/upload-links - Get all upload links (Admin/Super User only)
 *
 * Query params:
 * - status: filter by status (active, expired, used, cancelled)
 * - entityType: filter by entity type (supplier, franchisee, brand)
 * - limit: number of results
 * - offset: pagination offset
 */
export async function GET(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;

    const searchParams = request.nextUrl.searchParams;
    const status = searchParams.get("status") as UploadLinkStatus | null;
    const entityType = searchParams.get("entityType") as UploadLinkEntityType | null;
    const limit = searchParams.get("limit")
      ? parseInt(searchParams.get("limit")!, 10)
      : undefined;
    const offset = searchParams.get("offset")
      ? parseInt(searchParams.get("offset")!, 10)
      : undefined;

    const uploadLinks = await getAllUploadLinks({
      status: status || undefined,
      entityType: entityType || undefined,
      limit,
      offset,
    });

    // Parse period info from metadata
    const linksWithPeriodInfo = uploadLinks.map((link) => {
      const metadata = link.metadata as Record<string, unknown> | null;
      let periodInfo: UploadLinkPeriodInfo | undefined;

      if (metadata && metadata.periodId) {
        periodInfo = {
          periodId: metadata.periodId as string,
          periodName: metadata.periodName as string | undefined,
          periodStartDate: metadata.periodStartDate as string | undefined,
          periodEndDate: metadata.periodEndDate as string | undefined,
        };
      }

      return {
        ...link,
        periodInfo,
      };
    });

    return NextResponse.json({ uploadLinks: linksWithPeriodInfo });
  } catch (error) {
    console.error("Error fetching upload links:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}

/**
 * POST /api/upload-links - Generate a new secure upload link (Admin/Super User only)
 *
 * Request body:
 * - entityType: "supplier" | "franchisee" | "brand" (required)
 * - entityId: string (required)
 * - name: string (required) - Name/purpose of the upload link
 * - description: string (optional)
 * - allowedFileTypes: string (optional) - Comma-separated MIME types
 * - maxFileSize: number (optional) - Max file size in bytes
 * - maxFiles: number (optional, default: 1) - Max files allowed
 * - expiryDays: number (optional, default: 14) - Days until expiry
 * - periodInfo: object (optional) - Period information
 *   - periodId: string
 *   - periodName: string
 *   - periodStartDate: string
 *   - periodEndDate: string
 */
export async function POST(request: NextRequest) {
  try {
    const authResult = await requireAdminOrSuperUser(request);
    if (isAuthError(authResult)) return authResult;
    const { user } = authResult;

    const body = await request.json();
    const {
      entityType,
      entityId,
      name,
      description,
      allowedFileTypes,
      maxFileSize,
      maxFiles,
      expiryDays,
      periodInfo,
    } = body;

    // Validate required fields
    if (!entityType || !entityId || !name) {
      return NextResponse.json(
        { error: "entityType, entityId, and name are required" },
        { status: 400 }
      );
    }

    // Validate entity type
    if (!["supplier", "franchisee", "brand"].includes(entityType)) {
      return NextResponse.json(
        { error: "Invalid entityType. Must be 'supplier', 'franchisee', or 'brand'" },
        { status: 400 }
      );
    }

    // Validate expiryDays if provided
    if (expiryDays !== undefined && (typeof expiryDays !== "number" || expiryDays < 1 || expiryDays > 365)) {
      return NextResponse.json(
        { error: "expiryDays must be a number between 1 and 365" },
        { status: 400 }
      );
    }

    // Validate maxFiles if provided
    if (maxFiles !== undefined && (typeof maxFiles !== "number" || maxFiles < 1)) {
      return NextResponse.json(
        { error: "maxFiles must be a positive number" },
        { status: 400 }
      );
    }

    // Generate the secure upload link
    let uploadLink;

    if (entityType === "supplier") {
      uploadLink = await generateSupplierUploadLink(entityId, {
        name,
        description,
        allowedFileTypes,
        maxFileSize,
        expiryDays,
        periodInfo,
        createdBy: user.id,
      });
    } else if (entityType === "franchisee") {
      uploadLink = await generateFranchiseeUploadLink(entityId, {
        name,
        description,
        allowedFileTypes,
        maxFileSize,
        expiryDays,
        periodInfo,
        createdBy: user.id,
      });
    } else {
      // For brand or other entity types, use the generic function
      uploadLink = await generateSecureUploadLink({
        entityType: entityType as UploadLinkEntityType,
        entityId,
        name,
        description,
        allowedFileTypes,
        maxFileSize,
        maxFiles: maxFiles || 1,
        expiryDays,
        periodInfo,
        createdBy: user.id,
      });
    }

    return NextResponse.json({ uploadLink }, { status: 201 });
  } catch (error) {
    console.error("Error generating upload link:", error);
    return NextResponse.json(
      { error: "Internal server error" },
      { status: 500 }
    );
  }
}
