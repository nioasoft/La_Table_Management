-- Migration: Add Hebrew and English name fields to brand table
-- This supports Pat Vini, Mina Tomai, and King Kong brands with bilingual names

-- Add name_he column (Hebrew name - required)
ALTER TABLE "brand" ADD COLUMN "name_he" text;

-- Add name_en column (English name - optional)
ALTER TABLE "brand" ADD COLUMN "name_en" text;

-- Migrate existing data: copy name to name_he
UPDATE "brand" SET "name_he" = "name" WHERE "name_he" IS NULL AND "name" IS NOT NULL;

-- Make name_he NOT NULL after migration
ALTER TABLE "brand" ALTER COLUMN "name_he" SET NOT NULL;

-- Drop the old name column (optional - keeping it for backward compatibility)
-- ALTER TABLE "brand" DROP COLUMN "name";
