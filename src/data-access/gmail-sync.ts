/**
 * Email Sync Log Data Access Layer
 *
 * CRUD operations for the gmail_sync_log table (used for Resend Inbound sync tracking).
 * NOTE: Table is named gmail_sync_log for historical reasons — we use Resend Inbound, not Gmail.
 */

import { database } from "@/db";
import { gmailSyncLog, type GmailSyncLog, type GmailSyncStatus } from "@/db/schema";
import { eq, desc } from "drizzle-orm";

/**
 * Create a new sync log entry when an inbound email is received.
 */
export async function createSyncLogEntry(
  triggeredBy?: string
): Promise<GmailSyncLog> {
  const [entry] = await database
    .insert(gmailSyncLog)
    .values({
      status: "running",
      messagesScanned: 0,
      documentsCreated: 0,
      duplicatesSkipped: 0,
      errorCount: 0,
      triggeredBy: triggeredBy ?? null,
    })
    .returning();
  return entry;
}

/**
 * Update a sync log entry with processing results.
 */
export async function updateSyncLogEntry(
  id: string,
  data: {
    status?: GmailSyncStatus;
    messagesScanned?: number;
    documentsCreated?: number;
    duplicatesSkipped?: number;
    errorCount?: number;
    errorDetails?: unknown;
    runCompletedAt?: Date;
  }
): Promise<GmailSyncLog | null> {
  const [updated] = await database
    .update(gmailSyncLog)
    .set(data)
    .where(eq(gmailSyncLog.id, id))
    .returning();
  return updated ?? null;
}

/**
 * Get recent sync log entries for admin monitoring.
 */
export async function getRecentSyncLogs(
  limit = 20
): Promise<GmailSyncLog[]> {
  return database
    .select()
    .from(gmailSyncLog)
    .orderBy(desc(gmailSyncLog.createdAt))
    .limit(limit);
}
