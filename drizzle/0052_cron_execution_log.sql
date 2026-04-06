CREATE TABLE IF NOT EXISTS "cron_execution_log" (
  "id" text PRIMARY KEY NOT NULL,
  "job_name" text NOT NULL,
  "started_at" timestamp NOT NULL,
  "completed_at" timestamp,
  "status" text NOT NULL DEFAULT 'running',
  "trigger_type" text NOT NULL DEFAULT 'cron',
  "emails_sent" integer DEFAULT 0,
  "emails_failed" integer DEFAULT 0,
  "total_processed" integer DEFAULT 0,
  "total_skipped" integer DEFAULT 0,
  "total_failed" integer DEFAULT 0,
  "result_summary" jsonb,
  "error_message" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_cron_log_job_name" ON "cron_execution_log" ("job_name");
CREATE INDEX IF NOT EXISTS "idx_cron_log_started_at" ON "cron_execution_log" ("started_at" DESC);
