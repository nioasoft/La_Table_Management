-- Add commission_exceptions JSONB column to supplier table
-- Stores item-level commission rate overrides (e.g., "פיקדון" at 0%, "קפסולות" at 8%)
ALTER TABLE "supplier" ADD COLUMN "commission_exceptions" jsonb;
