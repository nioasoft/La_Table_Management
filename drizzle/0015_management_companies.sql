-- Create management_company table to track the 3 management companies that issue invoices
-- Companies: פנקון (Panikon), פדווילי (Pedvili), ונתמי (Ventami)

-- Create the management_company table
CREATE TABLE IF NOT EXISTS "management_company" (
	"id" text PRIMARY KEY NOT NULL,
	"code" text NOT NULL UNIQUE,
	"name_he" text NOT NULL,
	"name_en" text,
	"description" text,
	"contact_name" text,
	"contact_email" text,
	"contact_phone" text,
	"company_id" text,
	"address" text,
	"tax_id" text,
	"invoice_prefix" text,
	"next_invoice_number" integer DEFAULT 1 NOT NULL,
	"bank_name" text,
	"bank_branch" text,
	"bank_account_number" text,
	"is_active" boolean DEFAULT true NOT NULL,
	"created_at" timestamp DEFAULT now() NOT NULL,
	"updated_at" timestamp DEFAULT now() NOT NULL,
	"created_by" text
);

-- Add foreign key constraint for created_by
ALTER TABLE "management_company" ADD CONSTRAINT "management_company_created_by_user_id_fk" FOREIGN KEY ("created_by") REFERENCES "public"."user"("id") ON DELETE set null ON UPDATE no action;

-- Add indexes
CREATE INDEX IF NOT EXISTS "idx_management_company_code" ON "management_company" ("code");
CREATE INDEX IF NOT EXISTS "idx_management_company_is_active" ON "management_company" ("is_active");

-- Add management_company_id column to franchisee table
ALTER TABLE "franchisee" ADD COLUMN "management_company_id" text;

-- Add foreign key constraint
ALTER TABLE "franchisee" ADD CONSTRAINT "franchisee_management_company_id_management_company_id_fk" FOREIGN KEY ("management_company_id") REFERENCES "public"."management_company"("id") ON DELETE set null ON UPDATE no action;

-- Add index for management company lookup on franchisees
CREATE INDEX IF NOT EXISTS "idx_franchisee_management_company_id" ON "franchisee" ("management_company_id");

-- Add management_company to audit_entity_type enum if it doesn't exist
DO $$
BEGIN
    IF NOT EXISTS (
        SELECT 1 FROM pg_type t
        JOIN pg_enum e ON t.oid = e.enumtypid
        WHERE t.typname = 'audit_entity_type' AND e.enumlabel = 'management_company'
    ) THEN
        ALTER TYPE "audit_entity_type" ADD VALUE 'management_company';
    END IF;
END $$;
