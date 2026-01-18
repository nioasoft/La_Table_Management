-- VAT Rates table for tracking historical VAT rates
-- This allows accurate commission calculations when VAT rates change

CREATE TABLE IF NOT EXISTS "vat_rate" (
	"id" text PRIMARY KEY NOT NULL,
	"rate" numeric(5, 4) NOT NULL,
	"effective_from" date NOT NULL,
	"description" text,
	"notes" text,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);

-- Foreign key constraint
DO $$ BEGIN
	ALTER TABLE "vat_rate" ADD CONSTRAINT "vat_rate_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;
EXCEPTION
	WHEN duplicate_object THEN null;
END $$;

-- Indexes
CREATE INDEX IF NOT EXISTS "idx_vat_rate_effective_from" ON "vat_rate" USING btree ("effective_from");
CREATE UNIQUE INDEX IF NOT EXISTS "idx_vat_rate_effective_from_unique" ON "vat_rate" USING btree ("effective_from");

-- Seed data: Insert the current Israel VAT rate (18%) effective from 2000-01-01
-- This covers all historical data in the system
INSERT INTO "vat_rate" ("id", "rate", "effective_from", "description", "notes", "created_at", "updated_at")
VALUES (
	'vat_rate_' || gen_random_uuid()::text,
	0.1800,
	'2000-01-01',
	'Israel standard VAT rate',
	'Default VAT rate seeded during migration. Effective from 2000-01-01 to cover all historical data.',
	NOW(),
	NOW()
)
ON CONFLICT (effective_from) DO NOTHING;
