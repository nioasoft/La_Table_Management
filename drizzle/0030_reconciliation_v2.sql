-- Migration: Reconciliation V2 Tables
-- Adds tables for supplier reconciliation module
-- NOTE: Uses text type for IDs to match existing tables (supplier, franchisee, etc.)

-- Enums
DO $$ BEGIN
    CREATE TYPE "public"."reconciliation_session_status" AS ENUM('in_progress', 'completed', 'file_approved', 'file_rejected');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "public"."reconciliation_comparison_status" AS ENUM('pending', 'auto_approved', 'needs_review', 'manually_approved', 'sent_to_review_queue');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    CREATE TYPE "public"."reconciliation_review_queue_status" AS ENUM('pending', 'resolved');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Table: reconciliation_session
CREATE TABLE IF NOT EXISTS "reconciliation_session" (
    "id" text PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::text,
    "supplier_id" text NOT NULL,
    "supplier_file_id" text,
    "period_start_date" date NOT NULL,
    "period_end_date" date NOT NULL,
    "status" "reconciliation_session_status" DEFAULT 'in_progress' NOT NULL,
    "total_franchisees" integer DEFAULT 0 NOT NULL,
    "matched_count" integer DEFAULT 0 NOT NULL,
    "needs_review_count" integer DEFAULT 0 NOT NULL,
    "approved_count" integer DEFAULT 0 NOT NULL,
    "to_review_queue_count" integer DEFAULT 0 NOT NULL,
    "total_supplier_amount" numeric(12, 2) DEFAULT '0',
    "total_franchisee_amount" numeric(12, 2) DEFAULT '0',
    "total_difference" numeric(12, 2) DEFAULT '0',
    "file_rejection_reason" text,
    "file_approved_at" timestamp with time zone,
    "file_approved_by" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    "created_by" text,
    CONSTRAINT "reconciliation_session_supplier_period_unique" UNIQUE("supplier_id", "period_start_date", "period_end_date")
);

-- Table: reconciliation_comparison
CREATE TABLE IF NOT EXISTS "reconciliation_comparison" (
    "id" text PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::text,
    "session_id" text NOT NULL,
    "franchisee_id" text NOT NULL,
    "supplier_amount" numeric(12, 2) DEFAULT '0',
    "franchisee_amount" numeric(12, 2) DEFAULT '0',
    "difference" numeric(12, 2) DEFAULT '0',
    "absolute_difference" numeric(12, 2) DEFAULT '0',
    "supplier_original_name" text,
    "franchisee_file_id" text,
    "status" "reconciliation_comparison_status" DEFAULT 'pending' NOT NULL,
    "reviewed_by" text,
    "reviewed_at" timestamp with time zone,
    "review_notes" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL,
    CONSTRAINT "reconciliation_comparison_session_franchisee_unique" UNIQUE("session_id", "franchisee_id")
);

-- Table: reconciliation_review_queue
CREATE TABLE IF NOT EXISTS "reconciliation_review_queue" (
    "id" text PRIMARY KEY NOT NULL DEFAULT gen_random_uuid()::text,
    "comparison_id" text NOT NULL UNIQUE,
    "session_id" text NOT NULL,
    "supplier_id" text NOT NULL,
    "supplier_name" text NOT NULL,
    "franchisee_id" text NOT NULL,
    "franchisee_name" text NOT NULL,
    "period_start_date" date NOT NULL,
    "period_end_date" date NOT NULL,
    "supplier_amount" numeric(12, 2) DEFAULT '0',
    "franchisee_amount" numeric(12, 2) DEFAULT '0',
    "difference" numeric(12, 2) DEFAULT '0',
    "status" "reconciliation_review_queue_status" DEFAULT 'pending' NOT NULL,
    "resolved_by" text,
    "resolved_at" timestamp with time zone,
    "resolution_notes" text,
    "created_at" timestamp with time zone DEFAULT now() NOT NULL,
    "updated_at" timestamp with time zone DEFAULT now() NOT NULL
);

-- Foreign Key Constraints
ALTER TABLE "reconciliation_session" ADD CONSTRAINT "reconciliation_session_supplier_id_fk"
    FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "reconciliation_session" ADD CONSTRAINT "reconciliation_session_supplier_file_id_fk"
    FOREIGN KEY ("supplier_file_id") REFERENCES "public"."supplier_file_upload"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "reconciliation_comparison" ADD CONSTRAINT "reconciliation_comparison_session_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "reconciliation_session"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "reconciliation_comparison" ADD CONSTRAINT "reconciliation_comparison_franchisee_id_fk"
    FOREIGN KEY ("franchisee_id") REFERENCES "public"."franchisee"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "reconciliation_comparison" ADD CONSTRAINT "reconciliation_comparison_franchisee_file_id_fk"
    FOREIGN KEY ("franchisee_file_id") REFERENCES "public"."uploaded_file"("id") ON DELETE set null ON UPDATE no action;

ALTER TABLE "reconciliation_review_queue" ADD CONSTRAINT "reconciliation_review_queue_comparison_id_fk"
    FOREIGN KEY ("comparison_id") REFERENCES "reconciliation_comparison"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "reconciliation_review_queue" ADD CONSTRAINT "reconciliation_review_queue_session_id_fk"
    FOREIGN KEY ("session_id") REFERENCES "reconciliation_session"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "reconciliation_review_queue" ADD CONSTRAINT "reconciliation_review_queue_supplier_id_fk"
    FOREIGN KEY ("supplier_id") REFERENCES "public"."supplier"("id") ON DELETE cascade ON UPDATE no action;

ALTER TABLE "reconciliation_review_queue" ADD CONSTRAINT "reconciliation_review_queue_franchisee_id_fk"
    FOREIGN KEY ("franchisee_id") REFERENCES "public"."franchisee"("id") ON DELETE cascade ON UPDATE no action;

-- Indexes for performance
CREATE INDEX IF NOT EXISTS "reconciliation_session_supplier_idx" ON "reconciliation_session" ("supplier_id");
CREATE INDEX IF NOT EXISTS "reconciliation_session_period_idx" ON "reconciliation_session" ("period_start_date", "period_end_date");
CREATE INDEX IF NOT EXISTS "reconciliation_session_status_idx" ON "reconciliation_session" ("status");

CREATE INDEX IF NOT EXISTS "reconciliation_comparison_session_idx" ON "reconciliation_comparison" ("session_id");
CREATE INDEX IF NOT EXISTS "reconciliation_comparison_franchisee_idx" ON "reconciliation_comparison" ("franchisee_id");
CREATE INDEX IF NOT EXISTS "reconciliation_comparison_status_idx" ON "reconciliation_comparison" ("status");

CREATE INDEX IF NOT EXISTS "reconciliation_review_queue_session_idx" ON "reconciliation_review_queue" ("session_id");
CREATE INDEX IF NOT EXISTS "reconciliation_review_queue_status_idx" ON "reconciliation_review_queue" ("status");
