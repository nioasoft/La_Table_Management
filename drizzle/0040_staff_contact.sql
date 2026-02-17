-- Create staff_role enum
DO $$ BEGIN
  CREATE TYPE "public"."staff_role" AS ENUM('back_office', 'consultant', 'owner', 'chain_chef', 'brand_manager');
EXCEPTION
  WHEN duplicate_object THEN null;
END $$;

-- Create staff_contact table
CREATE TABLE IF NOT EXISTS "staff_contact" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "phone" text,
  "email" text,
  "role" "staff_role" NOT NULL,
  "brand_id" text REFERENCES "brand"("id") ON DELETE SET NULL,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by" text REFERENCES "user"("id") ON DELETE SET NULL
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "idx_staff_contact_brand" ON "staff_contact" ("brand_id");
CREATE INDEX IF NOT EXISTS "idx_staff_contact_role" ON "staff_contact" ("role");
CREATE INDEX IF NOT EXISTS "idx_staff_contact_is_active" ON "staff_contact" ("is_active");
