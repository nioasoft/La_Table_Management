-- Migration: Add franchisee important dates table for tracking franchise agreements, rental contracts, etc.

-- Create enum for important date types
DO $$ BEGIN
    CREATE TYPE "public"."important_date_type" AS ENUM('franchise_agreement', 'rental_contract', 'lease_option', 'custom');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create enum for duration units
DO $$ BEGIN
    CREATE TYPE "public"."duration_unit" AS ENUM('months', 'years');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create franchisee_important_date table
CREATE TABLE IF NOT EXISTS "franchisee_important_date" (
    "id" text PRIMARY KEY NOT NULL,
    "franchisee_id" text NOT NULL,
    "date_type" "important_date_type" NOT NULL,
    "custom_type_name" text,
    "start_date" date NOT NULL,
    "duration_months" integer NOT NULL,
    "display_unit" "duration_unit" DEFAULT 'months' NOT NULL,
    "end_date" date NOT NULL,
    "reminder_months_before" integer DEFAULT 3 NOT NULL,
    "reminder_date" date NOT NULL,
    "description" text,
    "notes" text,
    "is_active" boolean DEFAULT true NOT NULL,
    "created_at" timestamp DEFAULT now() NOT NULL,
    "updated_at" timestamp DEFAULT now() NOT NULL,
    "created_by" text
);

-- Add foreign key constraints
DO $$ BEGIN
    ALTER TABLE "franchisee_important_date" ADD CONSTRAINT "franchisee_important_date_franchisee_id_franchisee_id_fk" FOREIGN KEY ("franchisee_id") REFERENCES "public"."franchisee"("id") ON DELETE cascade ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

DO $$ BEGIN
    ALTER TABLE "franchisee_important_date" ADD CONSTRAINT "franchisee_important_date_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Create indexes
CREATE INDEX IF NOT EXISTS "idx_franchisee_important_date_franchisee" ON "franchisee_important_date" USING btree ("franchisee_id");
CREATE INDEX IF NOT EXISTS "idx_franchisee_important_date_type" ON "franchisee_important_date" USING btree ("date_type");
CREATE INDEX IF NOT EXISTS "idx_franchisee_important_date_end_date" ON "franchisee_important_date" USING btree ("end_date");
CREATE INDEX IF NOT EXISTS "idx_franchisee_important_date_reminder_date" ON "franchisee_important_date" USING btree ("reminder_date");
CREATE INDEX IF NOT EXISTS "idx_franchisee_important_date_is_active" ON "franchisee_important_date" USING btree ("is_active");
