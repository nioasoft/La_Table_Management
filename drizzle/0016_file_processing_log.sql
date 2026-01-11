-- Create file_processing_log table and related enums
-- This migration adds tracking for all file processing attempts

-- Create file processing status enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'file_processing_status') THEN
        CREATE TYPE "file_processing_status" AS ENUM (
            'success',
            'partial_success',
            'failed',
            'flagged'
        );
    END IF;
END $$;

-- Create file processing error category enum
DO $$
BEGIN
    IF NOT EXISTS (SELECT 1 FROM pg_type WHERE typname = 'file_processing_error_category') THEN
        CREATE TYPE "file_processing_error_category" AS ENUM (
            'file_format',
            'missing_columns',
            'invalid_data',
            'unmatched_franchisee',
            'configuration',
            'parsing',
            'validation',
            'system'
        );
    END IF;
END $$;

-- Create file_processing_log table
CREATE TABLE IF NOT EXISTS "file_processing_log" (
    "id" text PRIMARY KEY NOT NULL,
    "supplier_id" text NOT NULL,
    "supplier_name" text NOT NULL,
    "file_name" text NOT NULL,
    "file_size" integer NOT NULL,
    "mime_type" text,
    "status" "file_processing_status" NOT NULL,
    "total_rows" integer NOT NULL DEFAULT 0,
    "processed_rows" integer NOT NULL DEFAULT 0,
    "skipped_rows" integer NOT NULL DEFAULT 0,
    "error_count" integer NOT NULL DEFAULT 0,
    "warning_count" integer NOT NULL DEFAULT 0,
    "total_gross_amount" numeric(12, 2),
    "total_net_amount" numeric(12, 2),
    "matched_franchisees" integer NOT NULL DEFAULT 0,
    "unmatched_franchisees" integer NOT NULL DEFAULT 0,
    "franchisees_needing_review" integer NOT NULL DEFAULT 0,
    "errors" jsonb,
    "warnings" jsonb,
    "unmatched_franchisee_summary" jsonb,
    "processing_duration_ms" integer,
    "processed_by" text,
    "processed_by_name" text,
    "processed_by_email" text,
    "metadata" jsonb,
    "processed_at" timestamp NOT NULL DEFAULT now(),
    "created_at" timestamp NOT NULL DEFAULT now()
);

-- Add foreign key constraints
ALTER TABLE "file_processing_log"
    ADD CONSTRAINT "file_processing_log_supplier_id_supplier_id_fk"
    FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id")
    ON DELETE cascade ON UPDATE no action;

ALTER TABLE "file_processing_log"
    ADD CONSTRAINT "file_processing_log_processed_by_user_id_fk"
    FOREIGN KEY ("processed_by") REFERENCES "public"."user"("id")
    ON DELETE set null ON UPDATE no action;

-- Add indexes for common queries
CREATE INDEX IF NOT EXISTS "idx_file_processing_log_supplier" ON "file_processing_log" ("supplier_id");
CREATE INDEX IF NOT EXISTS "idx_file_processing_log_status" ON "file_processing_log" ("status");
CREATE INDEX IF NOT EXISTS "idx_file_processing_log_processed_at" ON "file_processing_log" ("processed_at");
CREATE INDEX IF NOT EXISTS "idx_file_processing_log_processed_by" ON "file_processing_log" ("processed_by");
CREATE INDEX IF NOT EXISTS "idx_file_processing_log_created_at" ON "file_processing_log" ("created_at");
