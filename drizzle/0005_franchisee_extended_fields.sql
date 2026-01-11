-- Migration: Add extended fields to franchisee table
-- This adds aliases, company ID, primary contact, owners, and important dates

-- Add aliases column (JSONB array of strings)
ALTER TABLE "franchisee" ADD COLUMN IF NOT EXISTS "aliases" jsonb;

-- Add company ID column
ALTER TABLE "franchisee" ADD COLUMN IF NOT EXISTS "company_id" text;

-- Add primary contact columns
ALTER TABLE "franchisee" ADD COLUMN IF NOT EXISTS "primary_contact_name" text;
ALTER TABLE "franchisee" ADD COLUMN IF NOT EXISTS "primary_contact_email" text;
ALTER TABLE "franchisee" ADD COLUMN IF NOT EXISTS "primary_contact_phone" text;

-- Add owners column (JSONB array of owner objects)
ALTER TABLE "franchisee" ADD COLUMN IF NOT EXISTS "owners" jsonb;

-- Add important date columns
ALTER TABLE "franchisee" ADD COLUMN IF NOT EXISTS "opening_date" date;
ALTER TABLE "franchisee" ADD COLUMN IF NOT EXISTS "lease_option_end" date;
ALTER TABLE "franchisee" ADD COLUMN IF NOT EXISTS "franchise_agreement_end" date;
