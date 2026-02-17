-- BKMV Small Supplier table
-- Names to include in purchase reports without commission
CREATE TABLE IF NOT EXISTS "bkmv_small_supplier" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "normalized_name" text NOT NULL,
  "created_by" text REFERENCES "user"("id") ON DELETE SET NULL,
  "notes" text,
  "created_at" timestamp DEFAULT now() NOT NULL
);

CREATE INDEX IF NOT EXISTS "idx_bkmv_small_supplier_normalized_name" ON "bkmv_small_supplier" ("normalized_name");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_bkmv_small_supplier_name_unique" ON "bkmv_small_supplier" ("normalized_name");
