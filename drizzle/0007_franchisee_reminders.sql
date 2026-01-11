-- Migration: Add franchisee reminders table
-- Supports reminder types: lease_option, franchise_agreement, custom
-- Tracks status: pending, sent, acknowledged, dismissed

-- Create franchisee reminder type enum
DO $$ BEGIN
  CREATE TYPE "franchisee_reminder_type" AS ENUM('lease_option', 'franchise_agreement', 'custom');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create franchisee reminders table
CREATE TABLE IF NOT EXISTS "franchisee_reminder" (
  "id" text PRIMARY KEY NOT NULL,
  "franchisee_id" text NOT NULL REFERENCES "franchisee"("id") ON DELETE CASCADE,
  "title" text NOT NULL,
  "description" text,
  "reminder_type" "franchisee_reminder_type" NOT NULL,
  "status" "reminder_status" DEFAULT 'pending' NOT NULL,
  "reminder_date" date NOT NULL,
  "days_before_notification" integer DEFAULT 30 NOT NULL,
  "recipients" jsonb NOT NULL,
  "notification_date" date NOT NULL,
  "sent_at" timestamp,
  "dismissed_at" timestamp,
  "dismissed_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "metadata" jsonb,
  "created_at" timestamp DEFAULT now() NOT NULL,
  "updated_at" timestamp DEFAULT now() NOT NULL,
  "created_by" text REFERENCES "user"("id") ON DELETE SET NULL
);

-- Create indexes for efficient querying
CREATE INDEX IF NOT EXISTS "idx_franchisee_reminder_franchisee" ON "franchisee_reminder" ("franchisee_id");
CREATE INDEX IF NOT EXISTS "idx_franchisee_reminder_type" ON "franchisee_reminder" ("reminder_type");
CREATE INDEX IF NOT EXISTS "idx_franchisee_reminder_status" ON "franchisee_reminder" ("status");
CREATE INDEX IF NOT EXISTS "idx_franchisee_reminder_date" ON "franchisee_reminder" ("reminder_date");
CREATE INDEX IF NOT EXISTS "idx_franchisee_reminder_notification_date" ON "franchisee_reminder" ("notification_date");

-- Add comment to describe the table purpose
COMMENT ON TABLE "franchisee_reminder" IS 'Reminders specific to franchisees for tracking important dates like lease options and franchise agreement expirations';
