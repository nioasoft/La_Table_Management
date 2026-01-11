import { database } from "@/db";
import {
  emailTemplate,
  emailLog,
  type EmailTemplate,
  type CreateEmailTemplateData,
  type UpdateEmailTemplateData,
  type EmailLog,
  type CreateEmailLogData,
  type EmailStatus,
} from "@/db/schema";
import { eq, desc, and, ilike, or } from "drizzle-orm";

// ============================================================================
// EMAIL TEMPLATE OPERATIONS
// ============================================================================

/**
 * Get all email templates
 */
export async function getEmailTemplates(): Promise<EmailTemplate[]> {
  return database
    .select()
    .from(emailTemplate)
    .orderBy(desc(emailTemplate.createdAt)) as unknown as Promise<EmailTemplate[]>;
}

/**
 * Get all active email templates
 */
export async function getActiveEmailTemplates(): Promise<EmailTemplate[]> {
  return database
    .select()
    .from(emailTemplate)
    .where(eq(emailTemplate.isActive, true))
    .orderBy(desc(emailTemplate.createdAt)) as unknown as Promise<EmailTemplate[]>;
}

/**
 * Get email templates by category
 */
export async function getEmailTemplatesByCategory(
  category: string
): Promise<EmailTemplate[]> {
  return database
    .select()
    .from(emailTemplate)
    .where(
      and(
        eq(emailTemplate.category, category),
        eq(emailTemplate.isActive, true)
      )
    )
    .orderBy(desc(emailTemplate.createdAt)) as unknown as Promise<EmailTemplate[]>;
}

/**
 * Get a single email template by ID
 */
export async function getEmailTemplateById(
  id: string
): Promise<EmailTemplate | null> {
  const results = (await database
    .select()
    .from(emailTemplate)
    .where(eq(emailTemplate.id, id))
    .limit(1)) as unknown as EmailTemplate[];
  return results[0] || null;
}

/**
 * Get a single email template by code
 */
export async function getEmailTemplateByCode(
  code: string
): Promise<EmailTemplate | null> {
  const results = (await database
    .select()
    .from(emailTemplate)
    .where(eq(emailTemplate.code, code))
    .limit(1)) as unknown as EmailTemplate[];
  return results[0] || null;
}

/**
 * Search email templates by name or code
 */
export async function searchEmailTemplates(
  query: string
): Promise<EmailTemplate[]> {
  const searchPattern = `%${query}%`;
  return database
    .select()
    .from(emailTemplate)
    .where(
      or(
        ilike(emailTemplate.name, searchPattern),
        ilike(emailTemplate.code, searchPattern),
        ilike(emailTemplate.subject, searchPattern)
      )
    )
    .orderBy(desc(emailTemplate.createdAt)) as unknown as Promise<EmailTemplate[]>;
}

/**
 * Create a new email template
 */
export async function createEmailTemplate(
  data: CreateEmailTemplateData
): Promise<EmailTemplate> {
  const [newTemplate] = (await database
    .insert(emailTemplate)
    .values(data)
    .returning()) as unknown as EmailTemplate[];
  return newTemplate;
}

/**
 * Update an existing email template
 */
export async function updateEmailTemplate(
  id: string,
  data: UpdateEmailTemplateData
): Promise<EmailTemplate | null> {
  const results = (await database
    .update(emailTemplate)
    .set({
      ...data,
      updatedAt: new Date(),
    })
    .where(eq(emailTemplate.id, id))
    .returning()) as unknown as EmailTemplate[];
  return results[0] || null;
}

/**
 * Delete an email template
 */
export async function deleteEmailTemplate(id: string): Promise<boolean> {
  const result = await database
    .delete(emailTemplate)
    .where(eq(emailTemplate.id, id));
  return (result.rowCount ?? 0) > 0;
}

/**
 * Toggle email template active status
 */
export async function toggleEmailTemplateStatus(
  id: string
): Promise<EmailTemplate | null> {
  const existingTemplate = await getEmailTemplateById(id);
  if (!existingTemplate) return null;

  const results = (await database
    .update(emailTemplate)
    .set({
      isActive: !existingTemplate.isActive,
      updatedAt: new Date(),
    })
    .where(eq(emailTemplate.id, id))
    .returning()) as unknown as EmailTemplate[];
  return results[0] || null;
}

/**
 * Check if a template code is unique
 */
export async function isTemplateCodeUnique(
  code: string,
  excludeId?: string
): Promise<boolean> {
  const existingTemplate = await getEmailTemplateByCode(code);
  if (!existingTemplate) return true;
  if (excludeId && existingTemplate.id === excludeId) return true;
  return false;
}

/**
 * Check if a template name is unique
 */
export async function isTemplateNameUnique(
  name: string,
  excludeId?: string
): Promise<boolean> {
  const results = (await database
    .select()
    .from(emailTemplate)
    .where(eq(emailTemplate.name, name))
    .limit(1)) as unknown as EmailTemplate[];
  const existingTemplate = results[0];
  if (!existingTemplate) return true;
  if (excludeId && existingTemplate.id === excludeId) return true;
  return false;
}

/**
 * Get email template statistics
 */
export async function getEmailTemplateStats(): Promise<{
  total: number;
  active: number;
  inactive: number;
  byCategory: Record<string, number>;
}> {
  const allTemplates = await getEmailTemplates();

  const stats = {
    total: allTemplates.length,
    active: 0,
    inactive: 0,
    byCategory: {} as Record<string, number>,
  };

  for (const t of allTemplates) {
    if (t.isActive) {
      stats.active++;
    } else {
      stats.inactive++;
    }

    const category = t.category || "uncategorized";
    stats.byCategory[category] = (stats.byCategory[category] || 0) + 1;
  }

  return stats;
}

// ============================================================================
// EMAIL LOG OPERATIONS
// ============================================================================

/**
 * Create an email log entry
 */
export async function createEmailLog(data: CreateEmailLogData): Promise<EmailLog> {
  const [newLog] = (await database
    .insert(emailLog)
    .values(data)
    .returning()) as unknown as EmailLog[];
  return newLog;
}

/**
 * Get email logs with optional filters
 */
export async function getEmailLogs(options?: {
  templateId?: string;
  status?: EmailStatus;
  entityType?: string;
  entityId?: string;
  limit?: number;
  offset?: number;
}): Promise<EmailLog[]> {
  let query = database.select().from(emailLog);

  const conditions = [];
  if (options?.templateId) {
    conditions.push(eq(emailLog.templateId, options.templateId));
  }
  if (options?.status) {
    conditions.push(eq(emailLog.status, options.status));
  }
  if (options?.entityType) {
    conditions.push(eq(emailLog.entityType, options.entityType));
  }
  if (options?.entityId) {
    conditions.push(eq(emailLog.entityId, options.entityId));
  }

  if (conditions.length > 0) {
    query = query.where(and(...conditions)) as typeof query;
  }

  query = query.orderBy(desc(emailLog.createdAt)) as typeof query;

  if (options?.limit) {
    query = query.limit(options.limit) as typeof query;
  }
  if (options?.offset) {
    query = query.offset(options.offset) as typeof query;
  }

  return query as unknown as Promise<EmailLog[]>;
}

/**
 * Get an email log by ID
 */
export async function getEmailLogById(id: string): Promise<EmailLog | null> {
  const results = (await database
    .select()
    .from(emailLog)
    .where(eq(emailLog.id, id))
    .limit(1)) as unknown as EmailLog[];
  return results[0] || null;
}

/**
 * Get an email log by Resend message ID
 */
export async function getEmailLogByMessageId(messageId: string): Promise<EmailLog | null> {
  const results = (await database
    .select()
    .from(emailLog)
    .where(eq(emailLog.messageId, messageId))
    .limit(1)) as unknown as EmailLog[];
  return results[0] || null;
}

/**
 * Update email log status
 */
export async function updateEmailLogStatus(
  id: string,
  status: EmailStatus,
  additionalData?: {
    messageId?: string;
    sentAt?: Date;
    deliveredAt?: Date;
    failedAt?: Date;
    errorMessage?: string;
  }
): Promise<EmailLog | null> {
  const updateData: Record<string, unknown> = { status };

  if (additionalData?.messageId) {
    updateData.messageId = additionalData.messageId;
  }
  if (additionalData?.sentAt) {
    updateData.sentAt = additionalData.sentAt;
  }
  if (additionalData?.deliveredAt) {
    updateData.deliveredAt = additionalData.deliveredAt;
  }
  if (additionalData?.failedAt) {
    updateData.failedAt = additionalData.failedAt;
  }
  if (additionalData?.errorMessage) {
    updateData.errorMessage = additionalData.errorMessage;
  }

  const results = (await database
    .update(emailLog)
    .set(updateData)
    .where(eq(emailLog.id, id))
    .returning()) as unknown as EmailLog[];
  return results[0] || null;
}

/**
 * Get email log statistics
 */
export async function getEmailLogStats(): Promise<{
  total: number;
  byStatus: Record<EmailStatus, number>;
  last24Hours: number;
  last7Days: number;
}> {
  const allLogs = await getEmailLogs();
  const now = new Date();
  const oneDayAgo = new Date(now.getTime() - 24 * 60 * 60 * 1000);
  const sevenDaysAgo = new Date(now.getTime() - 7 * 24 * 60 * 60 * 1000);

  const stats = {
    total: allLogs.length,
    byStatus: {
      pending: 0,
      sent: 0,
      delivered: 0,
      failed: 0,
      bounced: 0,
    } as Record<EmailStatus, number>,
    last24Hours: 0,
    last7Days: 0,
  };

  for (const log of allLogs) {
    stats.byStatus[log.status]++;

    const createdAt = new Date(log.createdAt);
    if (createdAt >= oneDayAgo) {
      stats.last24Hours++;
    }
    if (createdAt >= sevenDaysAgo) {
      stats.last7Days++;
    }
  }

  return stats;
}
