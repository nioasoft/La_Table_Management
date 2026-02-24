-- Create client table
CREATE TABLE IF NOT EXISTS "client" (
  "id" text PRIMARY KEY NOT NULL,
  "name" text NOT NULL,
  "company_id" text,
  "email" text,
  "contact_name" text,
  "hashavshevet_name" text,
  "pos_terminal_commission" numeric(5, 2),
  "dine_in_commission" numeric(5, 2),
  "delivery_commission" numeric(5, 2),
  "takeaway_commission" numeric(5, 2),
  "events_commission" numeric(5, 2),
  "additional_benefits" text,
  "invoice_generation" boolean NOT NULL DEFAULT false,
  "notes" text,
  "is_active" boolean NOT NULL DEFAULT true,
  "created_at" timestamp NOT NULL DEFAULT now(),
  "updated_at" timestamp NOT NULL DEFAULT now(),
  "created_by" text REFERENCES "user"("id") ON DELETE SET NULL
);

-- Create client_franchisee junction table
CREATE TABLE IF NOT EXISTS "client_franchisee" (
  "id" text PRIMARY KEY NOT NULL,
  "client_id" text NOT NULL REFERENCES "client"("id") ON DELETE CASCADE,
  "franchisee_id" text NOT NULL REFERENCES "franchisee"("id") ON DELETE CASCADE,
  "created_at" timestamp NOT NULL DEFAULT now()
);

-- Create indexes
CREATE INDEX IF NOT EXISTS "idx_client_is_active" ON "client" ("is_active");
CREATE INDEX IF NOT EXISTS "idx_client_name" ON "client" ("name");
CREATE INDEX IF NOT EXISTS "idx_client_franchisee_client" ON "client_franchisee" ("client_id");
CREATE INDEX IF NOT EXISTS "idx_client_franchisee_franchisee" ON "client_franchisee" ("franchisee_id");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_client_franchisee_unique" ON "client_franchisee" ("client_id", "franchisee_id");
