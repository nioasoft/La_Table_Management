-- Add franchisee_revenue_code table for multiple revenue account mappings per franchisee
-- This replaces the single revenue_account_code column on franchisee table

CREATE TABLE IF NOT EXISTS "franchisee_revenue_code" (
    "id" text PRIMARY KEY NOT NULL,
    "franchisee_id" text NOT NULL REFERENCES "franchisee"("id") ON DELETE CASCADE,
    "account_code" text NOT NULL,
    "account_name" text,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "created_by" text REFERENCES "user"("id") ON DELETE SET NULL
);

-- Unique constraint: each franchisee can only have one entry per account code
CREATE UNIQUE INDEX IF NOT EXISTS "idx_franchisee_revenue_code_unique"
    ON "franchisee_revenue_code" ("franchisee_id", "account_code");

-- Index for fast lookups by franchisee
CREATE INDEX IF NOT EXISTS "idx_franchisee_revenue_code_franchisee"
    ON "franchisee_revenue_code" ("franchisee_id");

-- Migrate existing data from franchisee.revenue_account_code column
INSERT INTO "franchisee_revenue_code" (id, franchisee_id, account_code, created_at)
SELECT gen_random_uuid()::text, id, revenue_account_code, now()
FROM franchisee
WHERE revenue_account_code IS NOT NULL
ON CONFLICT DO NOTHING;

-- Add comment for documentation
COMMENT ON TABLE "franchisee_revenue_code" IS 'Revenue account codes for franchisees - supports multiple codes per franchisee for BKMVDATA auto-matching';
