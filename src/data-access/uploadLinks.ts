import { database } from "@/db";
import {
  uploadLink,
  uploadedFile,
  brand,
  supplier,
  franchisee,
  settlementPeriod,
  type UploadLink,
  type CreateUploadLinkData,
  type UpdateUploadLinkData,
  type UploadedFile,
  type CreateUploadedFileData,
  type UploadLinkStatus,
  type BkmvProcessingResult,
} from "@/db/schema";
import { eq, and, desc, lt, or, sql, isNotNull, gte, lte, inArray, ne } from "drizzle-orm";
import { randomUUID } from "crypto";

// Entity types that can have upload links
export type UploadLinkEntityType = "supplier" | "franchisee" | "brand";

// Extended upload link type with entity info
export type UploadLinkWithEntity = UploadLink & {
  entityName?: string | null;
  filesUploaded?: number;
};

// Extended uploaded file type
export type UploadedFileWithLink = UploadedFile & {
  uploadLinkName?: string | null;
};

/**
 * Get an upload link by its token (for public access)
 */
export async function getUploadLinkByToken(
  token: string
): Promise<UploadLinkWithEntity | null> {
  const results = await database
    .select({
      id: uploadLink.id,
      token: uploadLink.token,
      name: uploadLink.name,
      description: uploadLink.description,
      status: uploadLink.status,
      entityType: uploadLink.entityType,
      entityId: uploadLink.entityId,
      allowedFileTypes: uploadLink.allowedFileTypes,
      maxFileSize: uploadLink.maxFileSize,
      maxFiles: uploadLink.maxFiles,
      expiresAt: uploadLink.expiresAt,
      usedAt: uploadLink.usedAt,
      usedByEmail: uploadLink.usedByEmail,
      metadata: uploadLink.metadata,
      createdAt: uploadLink.createdAt,
      updatedAt: uploadLink.updatedAt,
      createdBy: uploadLink.createdBy,
    })
    .from(uploadLink)
    .where(eq(uploadLink.token, token))
    .limit(1);

  if (results.length === 0) return null;

  const link = results[0];

  // Get entity name based on entity type
  let entityName: string | null = null;

  if (link.entityType === "brand") {
    const brandResult = await database
      .select({ name: brand.nameHe })
      .from(brand)
      .where(eq(brand.id, link.entityId))
      .limit(1);
    entityName = brandResult[0]?.name || null;
  } else if (link.entityType === "supplier") {
    const supplierResult = await database
      .select({ name: supplier.name })
      .from(supplier)
      .where(eq(supplier.id, link.entityId))
      .limit(1);
    entityName = supplierResult[0]?.name || null;
  } else if (link.entityType === "franchisee") {
    const franchiseeResult = await database
      .select({ name: franchisee.name })
      .from(franchisee)
      .where(eq(franchisee.id, link.entityId))
      .limit(1);
    entityName = franchiseeResult[0]?.name || null;
  }

  // Get count of uploaded files
  const filesResult = await database
    .select()
    .from(uploadedFile)
    .where(eq(uploadedFile.uploadLinkId, link.id));

  return {
    ...link,
    entityName,
    filesUploaded: filesResult.length,
  };
}

/**
 * Check if an upload link is valid (active and not expired)
 */
export function isUploadLinkValid(link: UploadLink): {
  valid: boolean;
  reason?: string;
} {
  // Check status
  if (link.status !== "active") {
    const statusMessages: Record<UploadLinkStatus, string> = {
      active: "",
      expired: "קישור זה פג תוקף",
      used: "קישור זה כבר נוצל",
      cancelled: "קישור זה בוטל",
    };
    return {
      valid: false,
      reason: statusMessages[link.status] || "קישור לא תקין",
    };
  }

  // Check expiration
  if (link.expiresAt && new Date() > new Date(link.expiresAt)) {
    return {
      valid: false,
      reason: "קישור זה פג תוקף",
    };
  }

  return { valid: true };
}

/**
 * Get an upload link by ID
 */
export async function getUploadLinkById(
  id: string
): Promise<UploadLinkWithEntity | null> {
  const results = await database
    .select()
    .from(uploadLink)
    .where(eq(uploadLink.id, id))
    .limit(1);

  if (results.length === 0) return null;

  const link = results[0];

  // Get entity name based on entity type
  let entityName: string | null = null;

  if (link.entityType === "brand") {
    const brandResult = await database
      .select({ name: brand.nameHe })
      .from(brand)
      .where(eq(brand.id, link.entityId))
      .limit(1);
    entityName = brandResult[0]?.name || null;
  } else if (link.entityType === "supplier") {
    const supplierResult = await database
      .select({ name: supplier.name })
      .from(supplier)
      .where(eq(supplier.id, link.entityId))
      .limit(1);
    entityName = supplierResult[0]?.name || null;
  } else if (link.entityType === "franchisee") {
    const franchiseeResult = await database
      .select({ name: franchisee.name })
      .from(franchisee)
      .where(eq(franchisee.id, link.entityId))
      .limit(1);
    entityName = franchiseeResult[0]?.name || null;
  }

  // Get count of uploaded files
  const filesResult = await database
    .select()
    .from(uploadedFile)
    .where(eq(uploadedFile.uploadLinkId, link.id));

  return {
    ...link,
    entityName,
    filesUploaded: filesResult.length,
  };
}

/**
 * Create a new upload link
 */
export async function createUploadLink(
  data: CreateUploadLinkData
): Promise<UploadLink> {
  const [newLink] = (await database
    .insert(uploadLink)
    .values(data)
    .returning()) as unknown as UploadLink[];
  return newLink;
}

/**
 * Update an upload link
 */
export async function updateUploadLink(
  id: string,
  data: UpdateUploadLinkData
): Promise<UploadLink | null> {
  const results = (await database
    .update(uploadLink)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(uploadLink.id, id))
    .returning()) as unknown as UploadLink[];
  return results[0] || null;
}

/**
 * Mark an upload link as used
 */
export async function markUploadLinkAsUsed(
  id: string,
  email?: string
): Promise<UploadLink | null> {
  const results = (await database
    .update(uploadLink)
    .set({
      status: "used",
      usedAt: new Date(),
      usedByEmail: email,
      updatedAt: new Date(),
    })
    .where(eq(uploadLink.id, id))
    .returning()) as unknown as UploadLink[];
  return results[0] || null;
}

/**
 * Get all upload links for an entity
 */
export async function getUploadLinksByEntity(
  entityType: UploadLinkEntityType,
  entityId: string
): Promise<UploadLinkWithEntity[]> {
  const results = await database
    .select()
    .from(uploadLink)
    .where(
      and(
        eq(uploadLink.entityType, entityType),
        eq(uploadLink.entityId, entityId)
      )
    )
    .orderBy(desc(uploadLink.createdAt));

  // Get files count for each link
  const linksWithCount = await Promise.all(
    results.map(async (link) => {
      const filesResult = await database
        .select()
        .from(uploadedFile)
        .where(eq(uploadedFile.uploadLinkId, link.id));
      return {
        ...link,
        filesUploaded: filesResult.length,
      };
    })
  );

  return linksWithCount;
}

/**
 * Create an uploaded file record
 */
export async function createUploadedFile(
  data: CreateUploadedFileData
): Promise<UploadedFile> {
  const [newFile] = (await database
    .insert(uploadedFile)
    .values(data)
    .returning()) as unknown as UploadedFile[];
  return newFile;
}

/**
 * Update an uploaded file's processing status and result
 */
export async function updateUploadedFileProcessingStatus(
  fileId: string,
  status: "pending" | "processing" | "auto_approved" | "needs_review" | "approved" | "rejected",
  bkmvProcessingResult?: BkmvProcessingResult | null,
  reviewedBy?: string | null,
  reviewNotes?: string | null
): Promise<UploadedFile | null> {
  const updateData: Partial<UploadedFile> = {
    processingStatus: status,
  };

  if (bkmvProcessingResult !== undefined) {
    updateData.bkmvProcessingResult = bkmvProcessingResult;
  }

  if (reviewedBy !== undefined) {
    updateData.reviewedBy = reviewedBy;
    updateData.reviewedAt = new Date();
  }

  if (reviewNotes !== undefined) {
    updateData.reviewNotes = reviewNotes;
  }

  const [updated] = (await database
    .update(uploadedFile)
    .set(updateData)
    .where(eq(uploadedFile.id, fileId))
    .returning()) as unknown as UploadedFile[];

  return updated || null;
}

/**
 * Get uploaded files that need review (needs_review status)
 * Only returns BKMVDATA files (files with bkmvProcessingResult set)
 * Supplier files without fileMapping are handled separately in supplier_file_upload table
 */
export async function getUploadedFilesNeedingReview(): Promise<UploadedFile[]> {
  return await database
    .select()
    .from(uploadedFile)
    .where(
      and(
        eq(uploadedFile.processingStatus, "needs_review"),
        isNotNull(uploadedFile.bkmvProcessingResult)
      )
    )
    .orderBy(desc(uploadedFile.createdAt));
}

/**
 * Get uploaded file by ID
 */
export async function getUploadedFileById(
  fileId: string
): Promise<UploadedFile | null> {
  const [file] = await database
    .select()
    .from(uploadedFile)
    .where(eq(uploadedFile.id, fileId));
  return file || null;
}

/**
 * Get uploaded files for an upload link
 */
export async function getUploadedFilesByLinkId(
  uploadLinkId: string
): Promise<UploadedFile[]> {
  return await database
    .select()
    .from(uploadedFile)
    .where(eq(uploadedFile.uploadLinkId, uploadLinkId))
    .orderBy(desc(uploadedFile.createdAt));
}

/**
 * Get count of uploaded files for an upload link
 */
export async function getUploadedFilesCount(
  uploadLinkId: string
): Promise<number> {
  const results = await database
    .select()
    .from(uploadedFile)
    .where(eq(uploadedFile.uploadLinkId, uploadLinkId));
  return results.length;
}

/**
 * Delete an upload link and its files
 */
export async function deleteUploadLink(id: string): Promise<boolean> {
  // Files are deleted via cascade in the database
  const result = await database.delete(uploadLink).where(eq(uploadLink.id, id));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Generate a unique token for an upload link
 */
export function generateUploadToken(): string {
  const array = new Uint8Array(32);
  crypto.getRandomValues(array);
  return Array.from(array, (b) => b.toString(16).padStart(2, "0")).join("");
}

/**
 * Expire all outdated upload links (utility function for cron jobs)
 */
export async function expireOutdatedUploadLinks(): Promise<number> {
  const result = await database
    .update(uploadLink)
    .set({
      status: "expired",
      updatedAt: new Date(),
    })
    .where(
      and(
        eq(uploadLink.status, "active"),
        lt(uploadLink.expiresAt, new Date())
      )
    );
  return result.rowCount ?? 0;
}

// ============================================================================
// SECURE UPLOAD LINK GENERATION HELPERS
// ============================================================================

// Default expiry for upload links (14 days)
export const UPLOAD_LINK_DEFAULT_EXPIRY_DAYS = 14;

// Period information for upload link metadata
export interface UploadLinkPeriodInfo {
  periodId?: string;
  periodName?: string;
  periodStartDate?: string;
  periodEndDate?: string;
}

// Options for generating a secure upload link
export interface GenerateUploadLinkOptions {
  entityType: UploadLinkEntityType;
  entityId: string;
  name: string;
  description?: string;
  allowedFileTypes?: string;
  maxFileSize?: number;
  maxFiles?: number;
  expiryDays?: number;
  periodInfo?: UploadLinkPeriodInfo;
  createdBy?: string;
}

// Response type for generated upload link
export interface GeneratedUploadLink {
  id: string;
  token: string;
  url: string;
  expiresAt: Date;
  status: UploadLinkStatus;
  entityType: string;
  entityId: string;
  entityName?: string;
  periodInfo?: UploadLinkPeriodInfo;
}

/**
 * Generate a secure UUID v4 token for upload links
 */
export function generateSecureUUIDToken(): string {
  return randomUUID();
}

/**
 * Calculate expiry date based on number of days
 */
export function calculateExpiryDate(days: number = UPLOAD_LINK_DEFAULT_EXPIRY_DAYS): Date {
  const expiryDate = new Date();
  expiryDate.setDate(expiryDate.getDate() + days);
  return expiryDate;
}

/**
 * Generate a secure upload link for a supplier with period information
 * - Uses UUID v4 token
 * - 14-day expiry by default
 * - Single use (maxFiles: 1)
 */
export async function generateSupplierUploadLink(
  supplierId: string,
  options: {
    name: string;
    description?: string;
    allowedFileTypes?: string;
    maxFileSize?: number;
    expiryDays?: number;
    periodInfo?: UploadLinkPeriodInfo;
    createdBy?: string;
  }
): Promise<GeneratedUploadLink> {
  return generateSecureUploadLink({
    entityType: "supplier",
    entityId: supplierId,
    ...options,
    maxFiles: 1, // Single use
  });
}

/**
 * Generate a secure upload link for a franchisee with period information
 * - Uses UUID v4 token
 * - 14-day expiry by default
 * - Single use (maxFiles: 1)
 */
export async function generateFranchiseeUploadLink(
  franchiseeId: string,
  options: {
    name: string;
    description?: string;
    allowedFileTypes?: string;
    maxFileSize?: number;
    expiryDays?: number;
    periodInfo?: UploadLinkPeriodInfo;
    createdBy?: string;
  }
): Promise<GeneratedUploadLink> {
  return generateSecureUploadLink({
    entityType: "franchisee",
    entityId: franchiseeId,
    ...options,
    maxFiles: 1, // Single use
  });
}

/**
 * Generate a secure upload link with full customization
 * - Uses UUID v4 token for security
 * - Configurable expiry (default: 14 days)
 * - Tracks status: pending (active) / uploaded (used) / expired
 * - Stores period information in metadata
 */
export async function generateSecureUploadLink(
  options: GenerateUploadLinkOptions
): Promise<GeneratedUploadLink> {
  const {
    entityType,
    entityId,
    name,
    description,
    allowedFileTypes,
    maxFileSize,
    maxFiles = 1,
    expiryDays = UPLOAD_LINK_DEFAULT_EXPIRY_DAYS,
    periodInfo,
    createdBy,
  } = options;

  // Generate secure UUID v4 token
  const token = generateSecureUUIDToken();
  const id = randomUUID();
  const expiresAt = calculateExpiryDate(expiryDays);

  // Prepare metadata with period information
  const metadata: Record<string, unknown> = {};
  if (periodInfo) {
    metadata.periodId = periodInfo.periodId;
    metadata.periodName = periodInfo.periodName;
    metadata.periodStartDate = periodInfo.periodStartDate;
    metadata.periodEndDate = periodInfo.periodEndDate;
  }

  // Create the upload link
  const newLink = await createUploadLink({
    id,
    token,
    name,
    description: description || null,
    status: "active",
    entityType,
    entityId,
    allowedFileTypes: allowedFileTypes || null,
    maxFileSize: maxFileSize || null,
    maxFiles,
    expiresAt,
    metadata: Object.keys(metadata).length > 0 ? metadata : null,
    createdBy: createdBy || null,
  });

  // Get entity name for response
  let entityName: string | undefined;

  if (entityType === "supplier") {
    const result = await database
      .select({ name: supplier.name })
      .from(supplier)
      .where(eq(supplier.id, entityId))
      .limit(1);
    entityName = result[0]?.name || undefined;
  } else if (entityType === "franchisee") {
    const result = await database
      .select({ name: franchisee.name })
      .from(franchisee)
      .where(eq(franchisee.id, entityId))
      .limit(1);
    entityName = result[0]?.name || undefined;
  } else if (entityType === "brand") {
    const result = await database
      .select({ name: brand.nameHe })
      .from(brand)
      .where(eq(brand.id, entityId))
      .limit(1);
    entityName = result[0]?.name || undefined;
  }

  // Build the upload URL
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "http://localhost:3000";
  const url = `${baseUrl}/upload/${token}`;

  return {
    id: newLink.id,
    token: newLink.token,
    url,
    expiresAt,
    status: newLink.status,
    entityType: newLink.entityType,
    entityId: newLink.entityId,
    entityName,
    periodInfo,
  };
}

/**
 * Generate upload links for a settlement period (for franchisees)
 * Creates links for all documents needed for the period
 */
export async function generatePeriodUploadLinks(
  periodId: string,
  options: {
    documentTypes: Array<{ name: string; description?: string; allowedFileTypes?: string }>;
    createdBy?: string;
  }
): Promise<GeneratedUploadLink[]> {
  // Get the settlement period details
  const periodResults = await database
    .select({
      id: settlementPeriod.id,
      name: settlementPeriod.name,
      franchiseeId: settlementPeriod.franchiseeId,
      periodStartDate: settlementPeriod.periodStartDate,
      periodEndDate: settlementPeriod.periodEndDate,
    })
    .from(settlementPeriod)
    .where(eq(settlementPeriod.id, periodId))
    .limit(1);

  if (periodResults.length === 0) {
    throw new Error(`Settlement period not found: ${periodId}`);
  }

  const period = periodResults[0];

  // Period-based settlements (franchiseeId = null) don't generate franchisee upload links
  if (!period.franchiseeId) {
    throw new Error(`Cannot generate franchisee upload links for period-based settlement: ${periodId}`);
  }

  const periodInfo: UploadLinkPeriodInfo = {
    periodId: period.id,
    periodName: period.name,
    periodStartDate: period.periodStartDate,
    periodEndDate: period.periodEndDate,
  };

  // Generate upload links for each document type
  const links = await Promise.all(
    options.documentTypes.map((docType) =>
      generateFranchiseeUploadLink(period.franchiseeId!, {
        name: docType.name,
        description: docType.description,
        allowedFileTypes: docType.allowedFileTypes,
        periodInfo,
        createdBy: options.createdBy,
      })
    )
  );

  return links;
}

/**
 * Get upload link status summary for an entity
 */
export async function getUploadLinkStatusSummary(
  entityType: UploadLinkEntityType,
  entityId: string
): Promise<{
  total: number;
  pending: number;
  uploaded: number;
  expired: number;
  cancelled: number;
}> {
  const links = await getUploadLinksByEntity(entityType, entityId);

  const summary = {
    total: links.length,
    pending: 0,
    uploaded: 0,
    expired: 0,
    cancelled: 0,
  };

  for (const link of links) {
    if (link.status === "active") {
      // Check if actually expired
      if (link.expiresAt && new Date() > new Date(link.expiresAt)) {
        summary.expired++;
      } else {
        summary.pending++;
      }
    } else if (link.status === "used") {
      summary.uploaded++;
    } else if (link.status === "expired") {
      summary.expired++;
    } else if (link.status === "cancelled") {
      summary.cancelled++;
    }
  }

  return summary;
}

/**
 * Cancel an upload link
 */
export async function cancelUploadLink(id: string): Promise<UploadLink | null> {
  return updateUploadLink(id, { status: "cancelled" });
}

/**
 * Get all upload links with period information
 */
export async function getUploadLinksWithPeriodInfo(
  entityType: UploadLinkEntityType,
  entityId: string
): Promise<(UploadLinkWithEntity & { periodInfo?: UploadLinkPeriodInfo })[]> {
  const links = await getUploadLinksByEntity(entityType, entityId);

  return links.map((link) => {
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
}

// ============================================================================
// DASHBOARD UPLOAD STATUS HELPERS
// ============================================================================

/**
 * Entity upload status for dashboard widget
 */
export interface EntityUploadStatus {
  id: string;
  name: string;
  entityType: UploadLinkEntityType;
  hasUploaded: boolean;
  uploadStats: {
    total: number;
    pending: number;
    uploaded: number;
    expired: number;
    cancelled: number;
  };
  pendingLinks: {
    id: string;
    name: string;
    expiresAt: Date | null;
    createdAt: Date;
  }[];
}

/**
 * Dashboard upload status response type
 */
export interface DashboardUploadStatus {
  suppliers: EntityUploadStatus[];
  franchisees: EntityUploadStatus[];
  summary: {
    totalEntities: number;
    entitiesWithUploads: number;
    entitiesWithoutUploads: number;
    totalPendingLinks: number;
    totalUploadedLinks: number;
    expiringSoon: number; // Links expiring in next 7 days
  };
}

/**
 * Get upload status for all entities for dashboard widget
 */
export async function getDashboardUploadStatus(): Promise<DashboardUploadStatus> {
  // Get all active suppliers
  const suppliers = await database
    .select({ id: supplier.id, name: supplier.name })
    .from(supplier)
    .where(eq(supplier.isActive, true));

  // Get all active franchisees
  const franchisees = await database
    .select({ id: franchisee.id, name: franchisee.name })
    .from(franchisee)
    .where(eq(franchisee.isActive, true));

  // Get all upload links for suppliers and franchisees
  const allUploadLinks = await database
    .select()
    .from(uploadLink)
    .where(
      or(
        eq(uploadLink.entityType, "supplier"),
        eq(uploadLink.entityType, "franchisee")
      )
    );

  // Get file counts for all upload links
  const allUploadedFiles = await database
    .select({
      uploadLinkId: uploadedFile.uploadLinkId,
    })
    .from(uploadedFile);

  const fileCountByLink = new Map<string, number>();
  for (const file of allUploadedFiles) {
    if (file.uploadLinkId) {
      const count = fileCountByLink.get(file.uploadLinkId) || 0;
      fileCountByLink.set(file.uploadLinkId, count + 1);
    }
  }

  // Group links by entity
  const linksByEntity = new Map<string, typeof allUploadLinks>();
  for (const link of allUploadLinks) {
    const key = `${link.entityType}:${link.entityId}`;
    const existing = linksByEntity.get(key) || [];
    existing.push(link);
    linksByEntity.set(key, existing);
  }

  // Calculate status for each supplier
  const supplierStatuses: EntityUploadStatus[] = suppliers.map((s) => {
    const links = linksByEntity.get(`supplier:${s.id}`) || [];
    const stats = calculateUploadStats(links);
    const pendingLinks = links
      .filter((l) => l.status === "active" && (!l.expiresAt || new Date() < new Date(l.expiresAt)))
      .map((l) => ({
        id: l.id,
        name: l.name,
        expiresAt: l.expiresAt,
        createdAt: l.createdAt!,
      }))
      .sort((a, b) => (a.expiresAt?.getTime() || Infinity) - (b.expiresAt?.getTime() || Infinity));

    return {
      id: s.id,
      name: s.name,
      entityType: "supplier" as const,
      hasUploaded: stats.uploaded > 0,
      uploadStats: stats,
      pendingLinks,
    };
  });

  // Calculate status for each franchisee
  const franchiseeStatuses: EntityUploadStatus[] = franchisees.map((f) => {
    const links = linksByEntity.get(`franchisee:${f.id}`) || [];
    const stats = calculateUploadStats(links);
    const pendingLinks = links
      .filter((l) => l.status === "active" && (!l.expiresAt || new Date() < new Date(l.expiresAt)))
      .map((l) => ({
        id: l.id,
        name: l.name,
        expiresAt: l.expiresAt,
        createdAt: l.createdAt!,
      }))
      .sort((a, b) => (a.expiresAt?.getTime() || Infinity) - (b.expiresAt?.getTime() || Infinity));

    return {
      id: f.id,
      name: f.name,
      entityType: "franchisee" as const,
      hasUploaded: stats.uploaded > 0,
      uploadStats: stats,
      pendingLinks,
    };
  });

  // Calculate summary
  const allEntities = [...supplierStatuses, ...franchiseeStatuses];
  const entitiesWithUploads = allEntities.filter((e) => e.hasUploaded).length;
  const totalPendingLinks = allEntities.reduce((sum, e) => sum + e.uploadStats.pending, 0);
  const totalUploadedLinks = allEntities.reduce((sum, e) => sum + e.uploadStats.uploaded, 0);

  // Count links expiring in next 7 days
  const sevenDaysFromNow = new Date();
  sevenDaysFromNow.setDate(sevenDaysFromNow.getDate() + 7);
  const expiringSoon = allUploadLinks.filter(
    (l) =>
      l.status === "active" &&
      l.expiresAt &&
      new Date(l.expiresAt) > new Date() &&
      new Date(l.expiresAt) <= sevenDaysFromNow
  ).length;

  return {
    suppliers: supplierStatuses,
    franchisees: franchiseeStatuses,
    summary: {
      totalEntities: allEntities.length,
      entitiesWithUploads,
      entitiesWithoutUploads: allEntities.length - entitiesWithUploads,
      totalPendingLinks,
      totalUploadedLinks,
      expiringSoon,
    },
  };
}

/**
 * Helper function to calculate upload stats from links
 */
function calculateUploadStats(links: { status: UploadLinkStatus; expiresAt: Date | null }[]): {
  total: number;
  pending: number;
  uploaded: number;
  expired: number;
  cancelled: number;
} {
  const stats = {
    total: links.length,
    pending: 0,
    uploaded: 0,
    expired: 0,
    cancelled: 0,
  };

  const now = new Date();
  for (const link of links) {
    if (link.status === "active") {
      // Check if actually expired
      if (link.expiresAt && now > new Date(link.expiresAt)) {
        stats.expired++;
      } else {
        stats.pending++;
      }
    } else if (link.status === "used") {
      stats.uploaded++;
    } else if (link.status === "expired") {
      stats.expired++;
    } else if (link.status === "cancelled") {
      stats.cancelled++;
    }
  }

  return stats;
}

/**
 * Get all upload links (admin function)
 */
export async function getAllUploadLinks(options?: {
  status?: UploadLinkStatus;
  entityType?: UploadLinkEntityType;
  limit?: number;
  offset?: number;
}): Promise<UploadLinkWithEntity[]> {
  let query = database
    .select()
    .from(uploadLink)
    .orderBy(desc(uploadLink.createdAt))
    .$dynamic();

  const conditions = [];

  if (options?.status) {
    conditions.push(eq(uploadLink.status, options.status));
  }

  if (options?.entityType) {
    conditions.push(eq(uploadLink.entityType, options.entityType));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions));
  }

  if (options?.limit) {
    query = query.limit(options.limit);
  }

  if (options?.offset) {
    query = query.offset(options.offset);
  }

  const results = await query;

  // Get files count for each link
  const linksWithCount = await Promise.all(
    results.map(async (link) => {
      const filesResult = await database
        .select()
        .from(uploadedFile)
        .where(eq(uploadedFile.uploadLinkId, link.id));

      // Get entity name
      let entityName: string | null = null;
      if (link.entityType === "supplier") {
        const result = await database
          .select({ name: supplier.name })
          .from(supplier)
          .where(eq(supplier.id, link.entityId))
          .limit(1);
        entityName = result[0]?.name || null;
      } else if (link.entityType === "franchisee") {
        const result = await database
          .select({ name: franchisee.name })
          .from(franchisee)
          .where(eq(franchisee.id, link.entityId))
          .limit(1);
        entityName = result[0]?.name || null;
      } else if (link.entityType === "brand") {
        const result = await database
          .select({ name: brand.nameHe })
          .from(brand)
          .where(eq(brand.id, link.entityId))
          .limit(1);
        entityName = result[0]?.name || null;
      }

      return {
        ...link,
        entityName,
        filesUploaded: filesResult.length,
      };
    })
  );

  return linksWithCount;
}

// ============================================================================
// BKMVDATA ADMIN UPLOAD FUNCTIONS
// ============================================================================

/**
 * Create an uploaded file record for admin uploads (without upload link)
 */
export async function createAdminUploadedFile(data: {
  id: string;
  fileName: string;
  originalFileName: string;
  fileUrl: string;
  fileSize: number;
  mimeType: string;
  franchiseeId: string;
  periodStartDate?: string;
  periodEndDate?: string;
  uploadedByEmail?: string;
  uploadedByIp?: string;
  processingStatus?: "pending" | "processing" | "auto_approved" | "needs_review" | "approved" | "rejected";
  bkmvProcessingResult?: BkmvProcessingResult | null;
  metadata?: Record<string, unknown>;
}): Promise<typeof uploadedFile.$inferSelect> {
  const [newFile] = await database
    .insert(uploadedFile)
    .values({
      id: data.id,
      uploadLinkId: null, // Admin uploads don't have upload links
      fileName: data.fileName,
      originalFileName: data.originalFileName,
      fileUrl: data.fileUrl,
      fileSize: data.fileSize,
      mimeType: data.mimeType,
      franchiseeId: data.franchiseeId,
      periodStartDate: data.periodStartDate,
      periodEndDate: data.periodEndDate,
      uploadedByEmail: data.uploadedByEmail,
      uploadedByIp: data.uploadedByIp,
      processingStatus: data.processingStatus || "pending",
      bkmvProcessingResult: data.bkmvProcessingResult,
      metadata: data.metadata,
    })
    .returning();

  return newFile;
}

/**
 * Get BKMVDATA upload history with filters
 */
export async function getBkmvUploadHistory(options: {
  franchiseeId?: string;
  periodStartDate?: string;
  periodEndDate?: string;
  status?: string[];
  limit?: number;
  offset?: number;
}): Promise<{
  files: Array<typeof uploadedFile.$inferSelect & { franchisee: typeof franchisee.$inferSelect | null }>;
  total: number;
}> {
  const conditions = [
    // Only include BKMVDATA files (those with processing result or admin uploads with franchiseeId)
    or(
      isNotNull(uploadedFile.bkmvProcessingResult),
      isNotNull(uploadedFile.franchiseeId)
    ),
  ];

  if (options.franchiseeId) {
    conditions.push(eq(uploadedFile.franchiseeId, options.franchiseeId));
  }

  if (options.periodStartDate) {
    conditions.push(gte(uploadedFile.periodStartDate, options.periodStartDate));
  }

  if (options.periodEndDate) {
    conditions.push(lte(uploadedFile.periodEndDate, options.periodEndDate));
  }

  if (options.status && options.status.length > 0) {
    conditions.push(
      inArray(
        uploadedFile.processingStatus,
        options.status as ("pending" | "processing" | "auto_approved" | "needs_review" | "approved" | "rejected")[]
      )
    );
  }

  // Get total count
  const countResult = await database
    .select({ count: sql<number>`count(*)` })
    .from(uploadedFile)
    .where(and(...conditions));

  const total = Number(countResult[0]?.count || 0);

  // Get files with franchisee info
  let query = database
    .select()
    .from(uploadedFile)
    .leftJoin(franchisee, eq(uploadedFile.franchiseeId, franchisee.id))
    .where(and(...conditions))
    .orderBy(desc(uploadedFile.createdAt));

  if (options.limit) {
    query = query.limit(options.limit) as typeof query;
  }

  if (options.offset) {
    query = query.offset(options.offset) as typeof query;
  }

  const results = await query;

  const files = results.map((row) => ({
    ...row.uploaded_file,
    franchisee: row.franchisee,
  }));

  return { files, total };
}

/**
 * Check for duplicate BKMVDATA upload for same franchisee and period
 */
export async function checkDuplicateBkmvUpload(
  franchiseeId: string,
  periodStartDate: string,
  periodEndDate: string
): Promise<{ exists: boolean; existingFile?: typeof uploadedFile.$inferSelect }> {
  const existing = await database
    .select()
    .from(uploadedFile)
    .where(
      and(
        eq(uploadedFile.franchiseeId, franchiseeId),
        eq(uploadedFile.periodStartDate, periodStartDate),
        eq(uploadedFile.periodEndDate, periodEndDate),
        // Don't count rejected files as duplicates
        ne(uploadedFile.processingStatus, "rejected")
      )
    )
    .limit(1);

  if (existing.length > 0) {
    return { exists: true, existingFile: existing[0] };
  }

  return { exists: false };
}
