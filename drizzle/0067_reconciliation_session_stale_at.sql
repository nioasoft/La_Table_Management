-- Mark a reconciliation session as stale when a newer supplier file or BKMV
-- upload lands for the same supplier+period after the session was built, so the
-- UI can prompt a rebuild (its stored amounts are out of date).
-- Applied directly to production 2026-06-07 (journal abandoned past 0056).
ALTER TABLE "reconciliation_session" ADD COLUMN IF NOT EXISTS "stale_at" timestamp;
