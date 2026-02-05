-- Supplier product table for per-item VAT management
-- Products are auto-extracted from supplier files and users can toggle VAT per product

CREATE TABLE IF NOT EXISTS "supplier_product" (
  "id" text PRIMARY KEY NOT NULL,
  "supplier_id" text NOT NULL REFERENCES "supplier"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "normalized_name" text NOT NULL,
  "vat_applicable" boolean NOT NULL DEFAULT false,
  "last_seen_at" timestamp NOT NULL DEFAULT now(),
  "created_at" timestamp NOT NULL DEFAULT now()
);

CREATE INDEX IF NOT EXISTS "idx_supplier_product_supplier" ON "supplier_product" ("supplier_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_supplier_product_unique" ON "supplier_product" ("supplier_id", "normalized_name");
