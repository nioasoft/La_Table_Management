-- Create file_request_status enum
CREATE TYPE "public"."file_request_status" AS ENUM('pending', 'sent', 'in_progress', 'submitted', 'expired', 'cancelled');

-- Create file_request table
CREATE TABLE IF NOT EXISTS "file_request" (
    "id" text PRIMARY KEY NOT NULL,
    "entity_type" text NOT NULL,
    "entity_id" text NOT NULL,
    "upload_link_id" text REFERENCES "upload_link"("id") ON DELETE SET NULL,
    "document_type" text NOT NULL,
    "description" text,
    "recipient_email" text NOT NULL,
    "recipient_name" text,
    "status" "file_request_status" DEFAULT 'pending' NOT NULL,
    "email_template_id" text REFERENCES "email_template"("id") ON DELETE SET NULL,
    "scheduled_for" timestamp,
    "due_date" date,
    "reminders_sent" jsonb,
    "sent_at" timestamp,
    "submitted_at" timestamp,
    "expires_at" timestamp,
    "metadata" jsonb,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "created_by" text REFERENCES "user"("id") ON DELETE SET NULL
);

-- Create indexes for file_request table
CREATE INDEX IF NOT EXISTS "idx_file_request_entity" ON "file_request" USING btree ("entity_type", "entity_id");
CREATE INDEX IF NOT EXISTS "idx_file_request_status" ON "file_request" USING btree ("status");
CREATE INDEX IF NOT EXISTS "idx_file_request_scheduled_for" ON "file_request" USING btree ("scheduled_for");
CREATE INDEX IF NOT EXISTS "idx_file_request_due_date" ON "file_request" USING btree ("due_date");
CREATE INDEX IF NOT EXISTS "idx_file_request_upload_link" ON "file_request" USING btree ("upload_link_id");
CREATE INDEX IF NOT EXISTS "idx_file_request_created_at" ON "file_request" USING btree ("created_at");
