-- Add fields for BKMVDATA history on uploaded_file table
-- This enables admin uploads (without upload links) and period-based organization

-- Make upload_link_id nullable for admin uploads
ALTER TABLE "uploaded_file" ALTER COLUMN "upload_link_id" DROP NOT NULL;

-- Add direct franchisee reference for admin uploads
ALTER TABLE "uploaded_file" ADD COLUMN "franchisee_id" text REFERENCES "franchisee"("id") ON DELETE SET NULL;

-- Add period dates for organizing BKMVDATA history
ALTER TABLE "uploaded_file" ADD COLUMN "period_start_date" date;
ALTER TABLE "uploaded_file" ADD COLUMN "period_end_date" date;

-- Add indexes for efficient queries
CREATE INDEX IF NOT EXISTS "idx_uploaded_file_franchisee" ON "uploaded_file" ("franchisee_id");
CREATE INDEX IF NOT EXISTS "idx_uploaded_file_period" ON "uploaded_file" ("period_start_date", "period_end_date");
