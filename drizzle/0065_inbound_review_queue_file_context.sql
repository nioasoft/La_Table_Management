-- Inbound Review Queue — Phase 2b file context.
--
-- Adds columns that let an admin recover a row that failed franchisee
-- resolution: the file is now uploaded to Vercel Blob even on the failure
-- path, and the parser's extracted data is persisted alongside, so the
-- review dialog can offer a one-click "confirm with this franchisee"
-- without re-fetching the original email from Resend (which only retains
-- attachments ~7 days).
--
-- Resolution columns are also added so the review UI can show what status
-- the row landed in and who/when actioned it.
--
-- Added 2026-05-10 for Layer 2b (Inbound Inbox actions).

ALTER TABLE "inbound_review_queue"
  ADD COLUMN IF NOT EXISTS "file_url"     text,
  ADD COLUMN IF NOT EXISTS "file_name"    text,
  ADD COLUMN IF NOT EXISTS "mime_type"    text,
  ADD COLUMN IF NOT EXISTS "file_size"    integer,
  ADD COLUMN IF NOT EXISTS "parsed_data"  jsonb,
  ADD COLUMN IF NOT EXISTS "period_month" integer,
  ADD COLUMN IF NOT EXISTS "period_year"  integer;
