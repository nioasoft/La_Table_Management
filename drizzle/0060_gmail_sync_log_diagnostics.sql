-- Add diagnostic columns to gmail_sync_log so production failures can be
-- investigated without forwarding the original email or relying on Vercel
-- console logs.
ALTER TABLE "gmail_sync_log" ADD COLUMN IF NOT EXISTS "email_id" text;
ALTER TABLE "gmail_sync_log" ADD COLUMN IF NOT EXISTS "from_address" text;
ALTER TABLE "gmail_sync_log" ADD COLUMN IF NOT EXISTS "to_addresses" jsonb;
ALTER TABLE "gmail_sync_log" ADD COLUMN IF NOT EXISTS "subject" text;
ALTER TABLE "gmail_sync_log" ADD COLUMN IF NOT EXISTS "client_code" text;
ALTER TABLE "gmail_sync_log" ADD COLUMN IF NOT EXISTS "identified_by" text;
-- Raw attachment list as seen by Resend, BEFORE filtering. Each row:
-- { filename, contentType, size }. Lets us see which contentType caused
-- attachments to be filtered out.
ALTER TABLE "gmail_sync_log" ADD COLUMN IF NOT EXISTS "raw_attachments" jsonb;
ALTER TABLE "gmail_sync_log" ADD COLUMN IF NOT EXISTS "raw_attachment_count" integer;
ALTER TABLE "gmail_sync_log" ADD COLUMN IF NOT EXISTS "filtered_attachment_count" integer;
-- HTML body excerpt (first 8KB) — only stored when no attachments AND no
-- downloadable links were found, so we can see what the email actually
-- contained without going to Resend.
ALTER TABLE "gmail_sync_log" ADD COLUMN IF NOT EXISTS "body_excerpt" text;

CREATE INDEX IF NOT EXISTS "idx_gmail_sync_log_email_id" ON "gmail_sync_log" ("email_id");
CREATE INDEX IF NOT EXISTS "idx_gmail_sync_log_client_code" ON "gmail_sync_log" ("client_code");
