-- Add franchisee_account_classification table for categorizing B110 accounts
-- Categories: supplier, revenue, employee, expense, uncategorized

CREATE TABLE IF NOT EXISTS "franchisee_account_classification" (
    "id" text PRIMARY KEY NOT NULL,
    "franchisee_id" text NOT NULL REFERENCES "franchisee"("id") ON DELETE CASCADE,
    "account_key" text NOT NULL,
    "account_name" text,
    "category" text NOT NULL,
    "created_at" timestamp NOT NULL DEFAULT now(),
    "updated_at" timestamp NOT NULL DEFAULT now(),
    "created_by" text REFERENCES "user"("id") ON DELETE SET NULL
);

-- Unique constraint: each franchisee can only have one classification per account key
CREATE UNIQUE INDEX IF NOT EXISTS "idx_franchisee_account_classification_unique"
    ON "franchisee_account_classification" ("franchisee_id", "account_key");

-- Index for fast lookups by franchisee
CREATE INDEX IF NOT EXISTS "idx_franchisee_account_classification_franchisee"
    ON "franchisee_account_classification" ("franchisee_id");

-- Index for fast lookups by franchisee + category
CREATE INDEX IF NOT EXISTS "idx_franchisee_account_classification_category"
    ON "franchisee_account_classification" ("franchisee_id", "category");

COMMENT ON TABLE "franchisee_account_classification" IS 'Account classifications for franchisee B110 accounts - categories: supplier, revenue, employee, expense, uncategorized';
