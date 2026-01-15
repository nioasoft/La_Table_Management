-- Add processing status fields to uploaded_file table
-- Used for tracking automatic BKMVDATA file processing and manual review workflow

-- Create enum for uploaded file review status
DO $$ BEGIN
    CREATE TYPE uploaded_file_review_status AS ENUM ('pending', 'processing', 'auto_approved', 'needs_review', 'approved', 'rejected');
EXCEPTION
    WHEN duplicate_object THEN null;
END $$;

-- Add processing status column
ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "processing_status" uploaded_file_review_status DEFAULT 'pending';

-- Add reviewed by (user id who reviewed)
ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "reviewed_by" text REFERENCES "user"("id") ON DELETE SET NULL;

-- Add reviewed at timestamp
ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "reviewed_at" timestamp;

-- Add review notes
ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "review_notes" text;

-- Add BKMV processing metadata (parsed data, match results, etc.)
ALTER TABLE "uploaded_file" ADD COLUMN IF NOT EXISTS "bkmv_processing_result" jsonb;

-- Create index for finding files needing review
CREATE INDEX IF NOT EXISTS "idx_uploaded_file_processing_status" ON "uploaded_file" ("processing_status");

-- Add comments for documentation
COMMENT ON COLUMN "uploaded_file"."processing_status" IS 'Status of file processing: pending, processing, auto_approved, needs_review, approved, rejected';
COMMENT ON COLUMN "uploaded_file"."reviewed_by" IS 'User ID who reviewed/approved the file';
COMMENT ON COLUMN "uploaded_file"."reviewed_at" IS 'Timestamp of when the file was reviewed';
COMMENT ON COLUMN "uploaded_file"."review_notes" IS 'Notes added during review';
COMMENT ON COLUMN "uploaded_file"."bkmv_processing_result" IS 'JSON result of BKMVDATA processing including parsed data and match results';
