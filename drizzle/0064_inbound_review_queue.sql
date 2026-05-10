-- Inbound Review Queue — Layer 2 of the inbound-pipeline overhaul.
--
-- One row per inbound email processed by /api/clients/email-inbound.
-- Captures the proposal (franchisee + doc type + confidence + alternatives),
-- the outcome (auto_committed | failed | needs_review), and a link to the
-- resulting client_document when one was created.
--
-- Purpose: replace the invisible `gmail_sync_log.error_details` blob with
-- a queryable table the admin UI can render — Reut should never have to
-- ask "did the email arrive?" again.
--
-- Layer 2a (this migration): Visibility — every inbound email writes a row,
--                            admin page reads them. No gating change yet.
-- Layer 2b (future):         Gating — failed/needs_review rows surface in UI
--                            with confirm/reject actions before committing.
--
-- Added 2026-05-10.

CREATE TABLE IF NOT EXISTS "inbound_review_queue" (
  "id" text PRIMARY KEY NOT NULL,

  -- Source linkage
  "gmail_sync_log_id" text,
  "gmail_message_id" text,
  "email_subject" text,
  "email_from" text,
  "email_received_at" timestamp,

  -- Client identification (which inbound parser was used)
  "client_id" text,
  "client_code" text,

  -- Proposal: what the resolver/classifier decided
  "proposed_franchisee_id" text,
  "proposed_franchisee_name" text,
  "franchisee_confidence" numeric(4, 3),
  "franchisee_alternatives" jsonb,
  "resolution_strategy" text,

  "proposed_document_type" text,
  "doc_type_source" text,

  -- Outcome
  "status" text NOT NULL,
  "failure_reason" text,
  "committed_client_document_id" text,

  -- Review
  "reviewed_by" text,
  "reviewed_at" timestamp,
  "review_notes" text,

  -- Timestamps
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now()
);
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inbound_review_queue"
    ADD CONSTRAINT "inbound_review_queue_gmail_sync_log_id_fk"
    FOREIGN KEY ("gmail_sync_log_id") REFERENCES "gmail_sync_log"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inbound_review_queue"
    ADD CONSTRAINT "inbound_review_queue_client_id_fk"
    FOREIGN KEY ("client_id") REFERENCES "client"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inbound_review_queue"
    ADD CONSTRAINT "inbound_review_queue_proposed_franchisee_id_fk"
    FOREIGN KEY ("proposed_franchisee_id") REFERENCES "franchisee"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inbound_review_queue"
    ADD CONSTRAINT "inbound_review_queue_committed_client_document_id_fk"
    FOREIGN KEY ("committed_client_document_id") REFERENCES "client_document"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
DO $$ BEGIN
  ALTER TABLE "inbound_review_queue"
    ADD CONSTRAINT "inbound_review_queue_reviewed_by_fk"
    FOREIGN KEY ("reviewed_by") REFERENCES "user"("id")
    ON DELETE SET NULL ON UPDATE NO ACTION;
EXCEPTION WHEN duplicate_object THEN null;
END $$;
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_review_queue_created_at_idx"
  ON "inbound_review_queue" ("created_at" DESC);
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_review_queue_status_idx"
  ON "inbound_review_queue" ("status");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_review_queue_client_code_idx"
  ON "inbound_review_queue" ("client_code");
--> statement-breakpoint
CREATE INDEX IF NOT EXISTS "inbound_review_queue_committed_client_document_id_idx"
  ON "inbound_review_queue" ("committed_client_document_id");
