-- Create contact_role enum
DO $$ BEGIN
  CREATE TYPE "public"."contact_role" AS ENUM('owner', 'manager', 'accountant', 'chef', 'staff', 'operations', 'marketing', 'other');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create contact table
CREATE TABLE IF NOT EXISTS "contact" (
  "id" text PRIMARY KEY NOT NULL,
  "franchisee_id" text REFERENCES "franchisee"("id") ON DELETE CASCADE,
  "brand_id" text REFERENCES "brand"("id") ON DELETE CASCADE,
  "name" text NOT NULL,
  "phone" text,
  "email" text,
  "role" "contact_role" NOT NULL DEFAULT 'other',
  "is_primary" boolean NOT NULL DEFAULT false,
  "notes" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by" text REFERENCES "user"("id") ON DELETE SET NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "idx_contact_franchisee" ON "contact" ("franchisee_id");
CREATE INDEX IF NOT EXISTS "idx_contact_brand" ON "contact" ("brand_id");
CREATE INDEX IF NOT EXISTS "idx_contact_role" ON "contact" ("role");
CREATE INDEX IF NOT EXISTS "idx_contact_is_active" ON "contact" ("is_active");
