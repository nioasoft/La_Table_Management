-- BKMV Blacklist table
-- Names to exclude from supplier matching in BKMVDATA files

CREATE TABLE IF NOT EXISTS "bkmv_blacklist" (
	"id" text PRIMARY KEY NOT NULL,
	"name" text NOT NULL,
	"normalized_name" text NOT NULL,
	"created_by" text REFERENCES "user"("id") ON DELETE SET NULL,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL
);

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_bkmv_blacklist_normalized_name" ON "bkmv_blacklist" USING btree ("normalized_name");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_bkmv_blacklist_name_unique" ON "bkmv_blacklist" USING btree ("normalized_name");
