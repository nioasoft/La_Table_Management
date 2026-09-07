ALTER TABLE "franchisee_billing" ADD COLUMN IF NOT EXISTS "stale_source_acknowledged" boolean DEFAULT false NOT NULL;
