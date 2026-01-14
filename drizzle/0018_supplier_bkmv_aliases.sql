-- Add BKMV aliases column to supplier table
-- Used for matching supplier names from franchisee unified reports (מבנה אחיד)

ALTER TABLE "supplier" ADD COLUMN IF NOT EXISTS "bkmv_aliases" jsonb;

COMMENT ON COLUMN "supplier"."bkmv_aliases" IS 'Alternative supplier names as they appear in BKMVDATA files (מבנה אחיד). Array of strings for fuzzy matching.';
