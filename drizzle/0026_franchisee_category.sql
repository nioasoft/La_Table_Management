-- Migration: Add franchisee category for distinguishing regular franchisees from other income sources
-- This enables tracking income from non-franchisee sources like "Don Pedro" separately

-- Create the franchisee_category enum
DO $$ BEGIN
    CREATE TYPE "public"."franchisee_category" AS ENUM('regular', 'other');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add category column to franchisee table with default 'regular'
ALTER TABLE "franchisee" ADD COLUMN IF NOT EXISTS "category" "franchisee_category" DEFAULT 'regular' NOT NULL;

-- Add is_system_brand column to brand table (for hiding "שונות" brand from regular UI)
ALTER TABLE "brand" ADD COLUMN IF NOT EXISTS "is_system_brand" boolean DEFAULT false NOT NULL;

-- Add index for category filtering
CREATE INDEX IF NOT EXISTS "idx_franchisee_category" ON "franchisee" USING btree ("category");

-- Add composite index for filtering regular franchisees by active status
CREATE INDEX IF NOT EXISTS "idx_franchisee_category_active" ON "franchisee" USING btree ("category", "is_active");

-- Add index for system brands
CREATE INDEX IF NOT EXISTS "idx_brand_is_system_brand" ON "brand" USING btree ("is_system_brand");
