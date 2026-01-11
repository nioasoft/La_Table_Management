import { database } from "@/db";
import {
  fileRequest,
  uploadLink,
  emailTemplate,
  emailLog,
  brand,
  supplier,
  franchisee,
  type FileRequest,
  type CreateFileRequestData,
  type UpdateFileRequestData,
  type FileRequestStatus,
  type UploadLink,
  type EmailTemplate,
} from "@/db/schema";
import { eq, and, desc, lt, lte, or, isNull, sql } from "drizzle-orm";
import { randomUUID } from "crypto";
import {
  generateSecureUploadLink,
  type UploadLinkEntityType,
  UPLOAD_LINK_DEFAULT_EXPIRY_DAYS,
} from "./uploadLinks";
import { sendEmailWithTemplate } from "@/lib/email/service";

// ============================================================================
// TYPES
// ============================================================================

// Extended file request type with related data
export type FileRequestWithDetails = FileRequest & {
  entityName?: string | null;
  uploadLink?: UploadLink | null;
  emailTemplate?: EmailTemplate | null;
  uploadUrl?: string | null;
  filesUploaded?: number;
};

// Options for creating a file request
export interface CreateFileRequestOptions {
  entityType: UploadLinkEntityType;
  entityId: string;
  documentType: string;
  description?: string;
  recipientEmail: string;
  recipientName?: string;
  emailTemplateId?: string;
  scheduledFor?: Date;
  dueDate?: string;
  expiryDays?: number;
  metadata?: Record<string, unknown>;
  createdBy?: string;
  sendImmediately?: boolean;
}

// Options for sending file request email
export interface SendFileRequestEmailOptions {
  fileRequestId: string;
  templateId?: string;
  variables?: Record<string, string>;
}

// Options for filtering file requests
export interface GetFileRequestsOptions {
  status?: FileRequestStatus;
  entityType?: string;
  entityId?: string;
  createdBy?: string;
  limit?: number;
  offset?: number;
  includeExpired?: boolean;
}

// ============================================================================
// CRUD OPERATIONS
// ============================================================================

/**
 * Get a file request by ID with related data
 */
export async function getFileRequestById(
  id: string
): Promise<FileRequestWithDetails | null> {
  const results = await database
    .select()
    .from(fileRequest)
    .where(eq(fileRequest.id, id))
    .limit(1);

  if (results.length === 0) return null;

  return enrichFileRequest(results[0]);
}

/**
 * Get file requests with optional filters
 */
export async function getFileRequests(
  options?: GetFileRequestsOptions
): Promise<FileRequestWithDetails[]> {
  let query = database
    .select()
    .from(fileRequest)
    .orderBy(desc(fileRequest.createdAt))
    .$dynamic();

  const conditions = [];

  if (options?.status) {
    conditions.push(eq(fileRequest.status, options.status));
  }

  if (options?.entityType) {
    conditions.push(eq(fileRequest.entityType, options.entityType));
  }

  if (options?.entityId) {
    conditions.push(eq(fileRequest.entityId, options.entityId));
  }

  if (options?.createdBy) {
    conditions.push(eq(fileRequest.createdBy, options.createdBy));
  }

  // By default, exclude expired requests unless specified
  if (!options?.includeExpired) {
    conditions.push(
      or(
        isNull(fileRequest.expiresAt),
        sql`${fileRequest.expiresAt} > NOW()`
      )
    );
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

  // Enrich with related data
  return Promise.all(results.map(enrichFileRequest));
}

/**
 * Get file requests for an entity
 */
export async function getFileRequestsForEntity(
  entityType: string,
  entityId: string
): Promise<FileRequestWithDetails[]> {
  return getFileRequests({ entityType, entityId, includeExpired: true });
}

/**
 * Get pending scheduled file requests that are due to be sent
 */
export async function getPendingScheduledRequests(): Promise<FileRequest[]> {
  return database
    .select()
    .from(fileRequest)
    .where(
      and(
        eq(fileRequest.status, "pending"),
        lte(fileRequest.scheduledFor, new Date())
      )
    )
    .orderBy(fileRequest.scheduledFor) as unknown as Promise<FileRequest[]>;
}

/**
 * Create a new file request with upload link generation
 */
export async function createFileRequest(
  options: CreateFileRequestOptions
): Promise<FileRequestWithDetails> {
  const {
    entityType,
    entityId,
    documentType,
    description,
    recipientEmail,
    recipientName,
    emailTemplateId,
    scheduledFor,
    dueDate,
    expiryDays = UPLOAD_LINK_DEFAULT_EXPIRY_DAYS,
    metadata,
    createdBy,
    sendImmediately = false,
  } = options;

  const id = randomUUID();
  const now = new Date();

  // Calculate expiry date
  const expiresAt = new Date();
  expiresAt.setDate(expiresAt.getDate() + expiryDays);

  // Generate secure upload link
  const generatedLink = await generateSecureUploadLink({
    entityType,
    entityId,
    name: `File Request: ${documentType}`,
    description: description || `Request for ${documentType}`,
    expiryDays,
    createdBy,
  });

  // Create the file request record
  const [newRequest] = (await database
    .insert(fileRequest)
    .values({
      id,
      entityType,
      entityId,
      uploadLinkId: generatedLink.id,
      documentType,
      description: description || null,
      recipientEmail,
      recipientName: recipientName || null,
      status: scheduledFor && scheduledFor > now ? "pending" : "pending",
      emailTemplateId: emailTemplateId || null,
      scheduledFor: scheduledFor || null,
      dueDate: dueDate || null,
      expiresAt,
      metadata: metadata || null,
      createdBy: createdBy || null,
    })
    .returning()) as unknown as FileRequest[];

  // Send email immediately if requested and no scheduling
  if (sendImmediately && (!scheduledFor || scheduledFor <= now)) {
    await sendFileRequestEmail({
      fileRequestId: id,
      templateId: emailTemplateId,
    });
  }

  return enrichFileRequest(newRequest);
}

/**
 * Update a file request
 */
export async function updateFileRequest(
  id: string,
  data: UpdateFileRequestData
): Promise<FileRequest | null> {
  const results = (await database
    .update(fileRequest)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(fileRequest.id, id))
    .returning()) as unknown as FileRequest[];
  return results[0] || null;
}

/**
 * Update file request status
 */
export async function updateFileRequestStatus(
  id: string,
  status: FileRequestStatus,
  additionalData?: {
    sentAt?: Date;
    submittedAt?: Date;
  }
): Promise<FileRequest | null> {
  const updateData: Record<string, unknown> = {
    status,
    updatedAt: new Date(),
  };

  if (additionalData?.sentAt) {
    updateData.sentAt = additionalData.sentAt;
  }

  if (additionalData?.submittedAt) {
    updateData.submittedAt = additionalData.submittedAt;
  }

  const results = (await database
    .update(fileRequest)
    .set(updateData)
    .where(eq(fileRequest.id, id))
    .returning()) as unknown as FileRequest[];
  return results[0] || null;
}

/**
 * Cancel a file request and its associated upload link
 */
export async function cancelFileRequest(id: string): Promise<FileRequest | null> {
  // Get the file request first
  const request = await getFileRequestById(id);
  if (!request) return null;

  // Cancel the upload link if it exists
  if (request.uploadLinkId) {
    await database
      .update(uploadLink)
      .set({
        status: "cancelled",
        updatedAt: new Date(),
      })
      .where(eq(uploadLink.id, request.uploadLinkId));
  }

  // Update the file request status
  return updateFileRequestStatus(id, "cancelled");
}

/**
 * Delete a file request
 */
export async function deleteFileRequest(id: string): Promise<boolean> {
  const result = await database
    .delete(fileRequest)
    .where(eq(fileRequest.id, id));
  return (result.rowCount ?? 0) > 0;
}

// ============================================================================
// EMAIL OPERATIONS
// ============================================================================

/**
 * Send file request email
 */
export async function sendFileRequestEmail(
  options: SendFileRequestEmailOptions
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  const { fileRequestId, templateId, variables = {} } = options;

  // Get the file request with details
  const request = await getFileRequestById(fileRequestId);
  if (!request) {
    return { success: false, error: "File request not found" };
  }

  // Determine template to use
  const templateToUse = templateId || request.emailTemplateId;
  if (!templateToUse) {
    return { success: false, error: "No email template specified" };
  }

  // Build template variables
  const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "http://localhost:3000";
  const uploadUrl = request.uploadLink
    ? `${baseUrl}/upload/${request.uploadLink.token}`
    : null;

  const templateVariables: Record<string, string> = {
    recipient_name: request.recipientName || request.recipientEmail,
    entity_name: request.entityName || "Unknown",
    document_type: request.documentType,
    upload_link: uploadUrl || "",
    due_date: request.dueDate || "",
    description: request.description || "",
    ...variables,
  };

  // Send the email
  const result = await sendEmailWithTemplate(templateToUse, templateVariables, {
    to: request.recipientEmail,
    toName: request.recipientName || undefined,
    entityType: "file_request",
    entityId: request.id,
    metadata: {
      fileRequestId: request.id,
      documentType: request.documentType,
    },
  });

  if (result.success) {
    // Update file request status to sent
    await updateFileRequestStatus(fileRequestId, "sent", {
      sentAt: new Date(),
    });
  }

  return result;
}

/**
 * Send reminder for a file request
 */
export async function sendFileRequestReminder(
  fileRequestId: string,
  templateId?: string
): Promise<{ success: boolean; error?: string; messageId?: string }> {
  const request = await getFileRequestById(fileRequestId);
  if (!request) {
    return { success: false, error: "File request not found" };
  }

  // Only send reminders for sent requests that haven't been submitted
  if (request.status !== "sent") {
    return { success: false, error: "File request is not in 'sent' status" };
  }

  const result = await sendFileRequestEmail({
    fileRequestId,
    templateId,
    variables: {
      is_reminder: "true",
    },
  });

  if (result.success) {
    // Track the reminder
    const remindersSent = (request.remindersSent || []) as string[];
    remindersSent.push(new Date().toISOString());
    await updateFileRequest(fileRequestId, {
      remindersSent,
    });
  }

  return result;
}

// ============================================================================
// SCHEDULED JOBS / CRON OPERATIONS
// ============================================================================

/**
 * Process scheduled file requests - sends emails for requests that are due
 */
export async function processScheduledFileRequests(): Promise<{
  processed: number;
  failed: number;
  errors: string[];
}> {
  const pendingRequests = await getPendingScheduledRequests();
  const results = {
    processed: 0,
    failed: 0,
    errors: [] as string[],
  };

  for (const request of pendingRequests) {
    try {
      const sendResult = await sendFileRequestEmail({
        fileRequestId: request.id,
        templateId: request.emailTemplateId || undefined,
      });

      if (sendResult.success) {
        results.processed++;
      } else {
        results.failed++;
        results.errors.push(`Request ${request.id}: ${sendResult.error}`);
      }
    } catch (error) {
      results.failed++;
      results.errors.push(
        `Request ${request.id}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  return results;
}

/**
 * Expire outdated file requests
 */
export async function expireOutdatedFileRequests(): Promise<number> {
  // Update file requests that have expired
  const result = await database
    .update(fileRequest)
    .set({
      status: "expired",
      updatedAt: new Date(),
    })
    .where(
      and(
        or(eq(fileRequest.status, "pending"), eq(fileRequest.status, "sent")),
        lt(fileRequest.expiresAt, new Date())
      )
    );

  return result.rowCount ?? 0;
}

/**
 * Send reminders for file requests approaching due date
 */
export async function sendDueDateReminders(
  daysBeforeDue: number = 3
): Promise<{
  sent: number;
  failed: number;
  errors: string[];
}> {
  // Calculate the reminder date
  const reminderDate = new Date();
  reminderDate.setDate(reminderDate.getDate() + daysBeforeDue);
  const reminderDateStr = reminderDate.toISOString().split("T")[0];

  // Find file requests that are due soon and haven't had a recent reminder
  const requests = await database
    .select()
    .from(fileRequest)
    .where(
      and(
        eq(fileRequest.status, "sent"),
        eq(fileRequest.dueDate, reminderDateStr)
      )
    );

  const results = {
    sent: 0,
    failed: 0,
    errors: [] as string[],
  };

  for (const request of requests) {
    try {
      const sendResult = await sendFileRequestReminder(request.id);
      if (sendResult.success) {
        results.sent++;
      } else {
        results.failed++;
        results.errors.push(`Request ${request.id}: ${sendResult.error}`);
      }
    } catch (error) {
      results.failed++;
      results.errors.push(
        `Request ${request.id}: ${error instanceof Error ? error.message : "Unknown error"}`
      );
    }
  }

  return results;
}

// ============================================================================
// STATISTICS
// ============================================================================

/**
 * Get file request statistics
 */
export async function getFileRequestStats(): Promise<{
  total: number;
  byStatus: Record<FileRequestStatus, number>;
  submissionRate: number;
  averageResponseDays: number | null;
}> {
  const allRequests = await getFileRequests({ includeExpired: true });

  const stats = {
    total: allRequests.length,
    byStatus: {
      pending: 0,
      sent: 0,
      in_progress: 0,
      submitted: 0,
      expired: 0,
      cancelled: 0,
    } as Record<FileRequestStatus, number>,
    submissionRate: 0,
    averageResponseDays: null as number | null,
  };

  let totalResponseDays = 0;
  let submittedCount = 0;

  for (const request of allRequests) {
    stats.byStatus[request.status]++;

    if (request.status === "submitted" && request.sentAt && request.submittedAt) {
      const sentDate = new Date(request.sentAt);
      const submittedDate = new Date(request.submittedAt);
      const days = Math.floor(
        (submittedDate.getTime() - sentDate.getTime()) / (1000 * 60 * 60 * 24)
      );
      totalResponseDays += days;
      submittedCount++;
    }
  }

  // Calculate submission rate (submitted / (sent + submitted))
  const completedRequests = stats.byStatus.submitted + stats.byStatus.sent;
  if (completedRequests > 0) {
    stats.submissionRate = (stats.byStatus.submitted / completedRequests) * 100;
  }

  // Calculate average response days
  if (submittedCount > 0) {
    stats.averageResponseDays = totalResponseDays / submittedCount;
  }

  return stats;
}

// ============================================================================
// HELPER FUNCTIONS
// ============================================================================

/**
 * Enrich a file request with related data
 */
async function enrichFileRequest(
  request: FileRequest
): Promise<FileRequestWithDetails> {
  let entityName: string | null = null;
  let uploadLinkData: UploadLink | null = null;
  let emailTemplateData: EmailTemplate | null = null;
  let uploadUrl: string | null = null;
  let filesUploaded = 0;

  // Get entity name
  if (request.entityType === "brand") {
    const result = await database
      .select({ name: brand.nameHe })
      .from(brand)
      .where(eq(brand.id, request.entityId))
      .limit(1);
    entityName = result[0]?.name || null;
  } else if (request.entityType === "supplier") {
    const result = await database
      .select({ name: supplier.name })
      .from(supplier)
      .where(eq(supplier.id, request.entityId))
      .limit(1);
    entityName = result[0]?.name || null;
  } else if (request.entityType === "franchisee") {
    const result = await database
      .select({ name: franchisee.name })
      .from(franchisee)
      .where(eq(franchisee.id, request.entityId))
      .limit(1);
    entityName = result[0]?.name || null;
  }

  // Get upload link data
  if (request.uploadLinkId) {
    const linkResult = await database
      .select()
      .from(uploadLink)
      .where(eq(uploadLink.id, request.uploadLinkId))
      .limit(1);
    uploadLinkData = (linkResult[0] as UploadLink) || null;

    if (uploadLinkData) {
      const baseUrl = process.env.NEXT_PUBLIC_APP_URL || process.env.VERCEL_URL || "http://localhost:3000";
      uploadUrl = `${baseUrl}/upload/${uploadLinkData.token}`;

      // Count uploaded files
      const { uploadedFile } = await import("@/db/schema");
      const filesResult = await database
        .select()
        .from(uploadedFile)
        .where(eq(uploadedFile.uploadLinkId, uploadLinkData.id));
      filesUploaded = filesResult.length;
    }
  }

  // Get email template data
  if (request.emailTemplateId) {
    const templateResult = await database
      .select()
      .from(emailTemplate)
      .where(eq(emailTemplate.id, request.emailTemplateId))
      .limit(1);
    emailTemplateData = (templateResult[0] as EmailTemplate) || null;
  }

  return {
    ...request,
    entityName,
    uploadLink: uploadLinkData,
    emailTemplate: emailTemplateData,
    uploadUrl,
    filesUploaded,
  };
}

/**
 * Mark file request as submitted when files are uploaded
 */
export async function markFileRequestAsSubmitted(
  uploadLinkId: string
): Promise<FileRequest | null> {
  // Find the file request for this upload link
  const results = await database
    .select()
    .from(fileRequest)
    .where(eq(fileRequest.uploadLinkId, uploadLinkId))
    .limit(1);

  if (results.length === 0) return null;

  const request = results[0];

  // Update status to submitted
  return updateFileRequestStatus(request.id, "submitted", {
    submittedAt: new Date(),
  });
}
