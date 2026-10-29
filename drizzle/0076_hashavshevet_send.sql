-- Direct sends to Hashavshevet (H-Connect) instead of Excel exports.
-- hashavshevet_company: one row per Hashavshevet company (file_name is what the API receives).
-- hashavshevet_send:    one row per "send" click (audit trail, never deleted).
-- hashavshevet_sent_row: the per-row lock; the partial unique index is what prevents double sends.
-- Additive only. Safe to re-run.
CREATE TABLE IF NOT EXISTS "hashavshevet_company" (
    "id" text PRIMARY KEY NOT NULL,
    "file_name" text NOT NULL,
    "comp_id" integer,
    "name_he" text NOT NULL,
    "live_from" date,
    "requires_approval" boolean DEFAULT true NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "updated_by" text REFERENCES "user"("id") ON DELETE SET NULL,
    CONSTRAINT "hashavshevet_company_file_name_unique" UNIQUE ("file_name")
);
--> statement-breakpoint
ALTER TABLE "brand"
    ADD COLUMN IF NOT EXISTS "hashavshevet_company_id" text REFERENCES "hashavshevet_company"("id") ON DELETE SET NULL;
--> statement-breakpoint
ALTER TABLE "franchisee"
    ADD COLUMN IF NOT EXISTS "hashavshevet_company_id" text REFERENCES "hashavshevet_company"("id") ON DELETE SET NULL;
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hashavshevet_send" (
    "id" text PRIMARY KEY NOT NULL,
    "export_type" text NOT NULL,
    "company_id" text NOT NULL REFERENCES "hashavshevet_company"("id") ON DELETE RESTRICT,
    "target_file_name" text NOT NULL,
    "plugin" text NOT NULL,
    "params" jsonb NOT NULL,
    "row_count" integer NOT NULL,
    "status" text DEFAULT 'pending' NOT NULL,
    "http_status" integer,
    "response" jsonb,
    "latency_ms" integer,
    "request_id" text,
    "sent_by" text REFERENCES "user"("id") ON DELETE SET NULL,
    "sent_at" timestamp DEFAULT now() NOT NULL,
    "resolved_by" text REFERENCES "user"("id") ON DELETE SET NULL,
    "resolved_at" timestamp,
    "resolution_note" text,
    CONSTRAINT "hashavshevet_send_status_check"
        CHECK ("status" IN ('pending', 'awaiting_approval', 'approved', 'rejected', 'failed', 'unknown'))
);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_hashavshevet_send_status"
    ON "hashavshevet_send" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_hashavshevet_send_company_type"
    ON "hashavshevet_send" ("company_id", "export_type");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_hashavshevet_send_sent_at"
    ON "hashavshevet_send" ("sent_at");
--> statement-breakpoint
CREATE TABLE IF NOT EXISTS "hashavshevet_sent_row" (
    "id" text PRIMARY KEY NOT NULL,
    "send_id" text NOT NULL REFERENCES "hashavshevet_send"("id") ON DELETE RESTRICT,
    "export_type" text NOT NULL,
    "company_id" text NOT NULL REFERENCES "hashavshevet_company"("id") ON DELETE RESTRICT,
    "row_key" text NOT NULL,
    "amount" numeric(14, 2) NOT NULL,
    "payload" jsonb NOT NULL,
    "unlocked_at" timestamp,
    "unlocked_by" text REFERENCES "user"("id") ON DELETE SET NULL,
    "unlock_reason" text
);
--> statement-breakpoint
CREATE UNIQUE INDEX IF NOT EXISTS "uq_hashavshevet_sent_row_active"
    ON "hashavshevet_sent_row" ("export_type", "company_id", "row_key")
    WHERE "unlocked_at" IS NULL;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "idx_hashavshevet_sent_row_send"
    ON "hashavshevet_sent_row" ("send_id");
