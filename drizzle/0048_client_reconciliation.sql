-- Client Reconciliation Module
-- Extends client table and adds document tracking, reconciliation, and Gmail sync tables

-- ============================================================================
-- NEW ENUMS
-- ============================================================================

DO $$ BEGIN
  CREATE TYPE "client_document_type" AS ENUM('client_report', 'tabit_report');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "client_document_source" AS ENUM('manual_upload', 'gmail_fetch');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
  CREATE TYPE "gmail_sync_status" AS ENUM('running', 'completed', 'failed');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- ============================================================================
-- EXTEND CLIENT TABLE
-- ============================================================================

ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "code" text;
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "parser_code" text;
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "hashavshevet_code" text;
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "file_format" text;
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "gmail_search_query" text;
ALTER TABLE "client" ADD COLUMN IF NOT EXISTS "gmail_sender_email" text;

-- Unique constraint on client code
CREATE UNIQUE INDEX IF NOT EXISTS "idx_client_code" ON "client" ("code") WHERE "code" IS NOT NULL;

-- ============================================================================
-- CLIENT DOCUMENT TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS "client_document" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text REFERENCES "client"("id") ON DELETE SET NULL,
  "franchisee_id" text NOT NULL REFERENCES "franchisee"("id") ON DELETE CASCADE,
  "document_type" "client_document_type" NOT NULL,
  "source" "client_document_source" NOT NULL,

  -- File info
  "original_file_name" text NOT NULL,
  "file_url" text,
  "file_size" integer,
  "mime_type" text,

  -- Period
  "period_month" integer NOT NULL,
  "period_year" integer NOT NULL,

  -- Processing
  "processing_status" "uploaded_file_review_status" NOT NULL DEFAULT 'pending',
  "processing_result" jsonb,
  "ocr_result" jsonb,

  -- Parsed amounts (denormalized)
  "total_amount" decimal(12, 2),
  "commission_amount" decimal(12, 2),
  "commission_rate" decimal(5, 2),
  "net_amount" decimal(12, 2),

  -- Email tracking
  "gmail_message_id" text,

  -- Review
  "reviewed_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp,
  "review_notes" text,

  -- Audit
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by" text REFERENCES "user"("id") ON DELETE SET NULL
);

-- Indexes for client_document
CREATE INDEX IF NOT EXISTS "idx_client_doc_client" ON "client_document" ("client_id");
CREATE INDEX IF NOT EXISTS "idx_client_doc_franchisee" ON "client_document" ("franchisee_id");
CREATE INDEX IF NOT EXISTS "idx_client_doc_period" ON "client_document" ("period_month", "period_year");
CREATE INDEX IF NOT EXISTS "idx_client_doc_type" ON "client_document" ("document_type");
CREATE INDEX IF NOT EXISTS "idx_client_doc_status" ON "client_document" ("processing_status");
CREATE INDEX IF NOT EXISTS "idx_client_doc_created" ON "client_document" ("created_at");

-- Unique: one client report per client+franchisee+period
CREATE UNIQUE INDEX IF NOT EXISTS "idx_client_doc_unique_report"
  ON "client_document" ("client_id", "franchisee_id", "period_month", "period_year")
  WHERE "document_type" = 'client_report';

-- Unique: one tabit report per franchisee+period
CREATE UNIQUE INDEX IF NOT EXISTS "idx_client_doc_unique_tabit"
  ON "client_document" ("franchisee_id", "period_month", "period_year")
  WHERE "document_type" = 'tabit_report';

-- Unique gmail message ID for dedup
CREATE UNIQUE INDEX IF NOT EXISTS "idx_client_doc_gmail_msg"
  ON "client_document" ("gmail_message_id")
  WHERE "gmail_message_id" IS NOT NULL;

-- ============================================================================
-- CLIENT RECONCILIATION SESSION TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS "client_reconciliation_session" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "client"("id") ON DELETE CASCADE,
  "period_month" integer NOT NULL,
  "period_year" integer NOT NULL,

  -- Status (reuses existing enum)
  "status" "reconciliation_session_status" NOT NULL DEFAULT 'in_progress',

  -- Statistics
  "total_franchisees" integer NOT NULL DEFAULT 0,
  "matched_count" integer NOT NULL DEFAULT 0,
  "needs_review_count" integer NOT NULL DEFAULT 0,
  "approved_count" integer NOT NULL DEFAULT 0,

  -- Totals
  "total_client_amount" decimal(12, 2),
  "total_tabit_amount" decimal(12, 2),
  "total_difference" decimal(12, 2),

  -- Approval
  "file_approved_at" timestamp,
  "file_approved_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "file_rejection_reason" text,

  -- Audit
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by" text REFERENCES "user"("id") ON DELETE SET NULL
);

-- Indexes for client_reconciliation_session
CREATE INDEX IF NOT EXISTS "idx_client_recon_session_client" ON "client_reconciliation_session" ("client_id");
CREATE INDEX IF NOT EXISTS "idx_client_recon_session_status" ON "client_reconciliation_session" ("status");
CREATE INDEX IF NOT EXISTS "idx_client_recon_session_period" ON "client_reconciliation_session" ("period_month", "period_year");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_client_recon_session_unique"
  ON "client_reconciliation_session" ("client_id", "period_month", "period_year");

-- ============================================================================
-- CLIENT RECONCILIATION COMPARISON TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS "client_reconciliation_comparison" (
  "id" text PRIMARY KEY NOT NULL,
  "session_id" text NOT NULL REFERENCES "client_reconciliation_session"("id") ON DELETE CASCADE,
  "franchisee_id" text NOT NULL REFERENCES "franchisee"("id") ON DELETE CASCADE,

  -- Document references
  "client_document_id" text REFERENCES "client_document"("id") ON DELETE SET NULL,
  "tabit_document_id" text REFERENCES "client_document"("id") ON DELETE SET NULL,

  -- Amounts
  "client_amount" decimal(12, 2),
  "tabit_amount" decimal(12, 2),
  "difference" decimal(12, 2),
  "absolute_difference" decimal(12, 2),

  -- Commission validation
  "expected_commission_rate" decimal(5, 2),
  "actual_commission_rate" decimal(5, 2),
  "commission_amount" decimal(12, 2),
  "net_amount" decimal(12, 2),

  -- Status (reuses existing enum)
  "status" "reconciliation_comparison_status" NOT NULL DEFAULT 'pending',

  -- Review
  "reviewed_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "reviewed_at" timestamp,
  "review_notes" text,
  "notes" text
);

-- Indexes for client_reconciliation_comparison
CREATE INDEX IF NOT EXISTS "idx_client_recon_comp_session" ON "client_reconciliation_comparison" ("session_id");
CREATE INDEX IF NOT EXISTS "idx_client_recon_comp_franchisee" ON "client_reconciliation_comparison" ("franchisee_id");
CREATE INDEX IF NOT EXISTS "idx_client_recon_comp_status" ON "client_reconciliation_comparison" ("status");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_client_recon_comp_unique"
  ON "client_reconciliation_comparison" ("session_id", "franchisee_id");

-- ============================================================================
-- GMAIL SYNC LOG TABLE
-- ============================================================================

CREATE TABLE IF NOT EXISTS "gmail_sync_log" (
  "id" text PRIMARY KEY NOT NULL,
  "run_started_at" timestamp NOT NULL DEFAULT now(),
  "run_completed_at" timestamp,
  "status" "gmail_sync_status" NOT NULL DEFAULT 'running',

  -- Stats
  "messages_scanned" integer NOT NULL DEFAULT 0,
  "documents_created" integer NOT NULL DEFAULT 0,
  "duplicates_skipped" integer NOT NULL DEFAULT 0,
  "error_count" integer NOT NULL DEFAULT 0,

  -- Error details
  "error_details" jsonb,

  -- Audit
  "triggered_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_gmail_sync_log_status" ON "gmail_sync_log" ("status");
CREATE INDEX IF NOT EXISTS "idx_gmail_sync_log_created" ON "gmail_sync_log" ("created_at");

-- ============================================================================
-- EXTEND AUDIT ENTITY TYPE ENUM
-- ============================================================================

ALTER TYPE "audit_entity_type" ADD VALUE IF NOT EXISTS 'client_document';
ALTER TYPE "audit_entity_type" ADD VALUE IF NOT EXISTS 'client_reconciliation';
