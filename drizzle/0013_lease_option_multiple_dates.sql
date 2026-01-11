-- Migration: Replace single leaseOptionEnd with three separate lease option end dates
-- This allows tracking multiple lease option dates for franchisees

-- Add the three new lease option columns
ALTER TABLE "franchisee" ADD COLUMN IF NOT EXISTS "lease_option_1_end" date;
ALTER TABLE "franchisee" ADD COLUMN IF NOT EXISTS "lease_option_2_end" date;
ALTER TABLE "franchisee" ADD COLUMN IF NOT EXISTS "lease_option_3_end" date;

-- Migrate existing data: copy leaseOptionEnd to leaseOption1End
UPDATE "franchisee"
SET "lease_option_1_end" = "lease_option_end"
WHERE "lease_option_end" IS NOT NULL;

-- Drop the old column
ALTER TABLE "franchisee" DROP COLUMN IF EXISTS "lease_option_end";
