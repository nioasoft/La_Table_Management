import { database } from "@/db";
import { cronExecutionLog } from "@/db/schema";
import { randomUUID } from "crypto";
import { desc, eq } from "drizzle-orm";

export type CronJobName =
  | "file-requests"
  | "settlement-requests"
  | "upload-reminders"
  | "franchisee-reminders"
  | "bkmv-requests"
  | "monthly-upload-reminder";

export type CronTriggerType = "cron" | "manual";

export interface CronLogResult {
  emailsSent?: number;
  emailsFailed?: number;
  totalProcessed?: number;
  totalSkipped?: number;
  totalFailed?: number;
  summary?: Record<string, unknown>;
}

/**
 * Start a cron execution log entry. Returns a `complete` function
 * that should be called when the job finishes.
 */
export async function startCronLog(
  jobName: CronJobName,
  triggerType: CronTriggerType = "cron"
) {
  const id = randomUUID();
  const startedAt = new Date();

  await database.insert(cronExecutionLog).values({
    id,
    jobName,
    startedAt,
    status: "running",
    triggerType,
  });

  return {
    id,
    async complete(result: CronLogResult, error?: string) {
      const status = error
        ? "failed"
        : (result.totalFailed ?? 0) > 0
          ? "partial"
          : "success";

      await database
        .update(cronExecutionLog)
        .set({
          completedAt: new Date(),
          status,
          emailsSent: result.emailsSent ?? 0,
          emailsFailed: result.emailsFailed ?? 0,
          totalProcessed: result.totalProcessed ?? 0,
          totalSkipped: result.totalSkipped ?? 0,
          totalFailed: result.totalFailed ?? 0,
          resultSummary: result.summary ?? null,
          errorMessage: error ?? null,
        })
        .where(eq(cronExecutionLog.id, id));
    },
  };
}

/** Fetch recent execution logs, optionally filtered by job name */
export async function getCronExecutionLogs(options?: {
  jobName?: CronJobName;
  limit?: number;
}) {
  const { jobName, limit = 50 } = options ?? {};

  const query = database
    .select()
    .from(cronExecutionLog)
    .orderBy(desc(cronExecutionLog.startedAt))
    .limit(limit);

  if (jobName) {
    return query.where(eq(cronExecutionLog.jobName, jobName));
  }

  return query;
}
